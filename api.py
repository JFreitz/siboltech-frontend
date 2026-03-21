#!/usr/bin/env python3
"""
Simple Flask API to serve sensor data from cloud DB.
Deploy on Railway, Vercel calls this for dashboard.
"""


import os
import requests
from datetime import datetime, timezone
from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import importlib.util


app = Flask(__name__)
CORS(app)

DB_URL = os.getenv("DATABASE_URL", "sqlite:///sensors.db")  # Cloud URL in production
engine = create_engine(DB_URL, echo=False)
Session = sessionmaker(bind=engine)

# Import SensorReading for saving relay states
import sys
sys.path.insert(0, os.path.dirname(__file__))
from db import SensorReading
from automation import AutomationController

# In-memory relay states (persisted in DB for reliability)
RELAY_STATES = {i: False for i in range(1, 10)}  # 9 relays

RELAY_LABELS = {
    1: "Leafy Green",
    2: "pH Down",
    3: "pH Up",
    4: "Misting Pump",
    5: "Exhaust Out",
    6: "Grow Lights (Aeroponics)",
    7: "Air Pump",
    8: "Grow Lights (DWC)",
    9: "Exhaust In"
}


def _init_relay_states():
    """Load relay states from DB on startup."""
    global RELAY_STATES
    try:
        with Session() as session:
            for i in range(1, 10):  # 9 relays
                row = session.execute(
                    text("SELECT value FROM sensor_readings WHERE sensor = :s ORDER BY timestamp DESC LIMIT 1"),
                    {"s": f"relay_{i}"}
                ).first()
                if row:
                    RELAY_STATES[i] = row[0] == 1.0
    except Exception as e:
        print(f"Error loading relay states: {e}")


def _save_relay_state(relay_id, state):
    """Save relay state to DB for persistence."""
    try:
        with Session() as session:
            session.add(SensorReading(
                timestamp=datetime.now(timezone.utc),
                sensor=f"relay_{relay_id}",
                value=1.0 if state else 0.0,
                unit="state",
                meta={"label": RELAY_LABELS.get(relay_id)}
            ))
            session.commit()
    except Exception as e:
        print(f"Error saving relay state: {e}")


# Initialize relay states on startup
_init_relay_states()

# Start automation controller (relay control runs in background thread)
def _set_relay_via_api(relay_id, state):
    """Internal callback to set relay via API (prevents recursion)"""
    try:
        endpoint = f"http://localhost:5000/api/relay/{relay_id}/{'on' if state else 'off'}"
        requests.post(endpoint, timeout=2)
    except:
        pass

automation_controller = AutomationController(relay_callback=_set_relay_via_api)
automation_controller.start()
print("[API] Automation started (misting: 10s ON / 3m OFF, lights: 6am-6pm)")

# Background thread to feed sensor data to automation
import threading
import time

def _automation_sensor_feeder():
    """Feed latest sensor readings to automation controller every second"""
    while True:
        try:
            with Session() as session:
                sensors = {}
                for sensor, key in [("temperature_c", "temperature_c"), ("humidity", "humidity"), 
                                   ("ph", "ph"), ("do_mg_per_l", "do_mg_l"), ("tds_ppm", "tds_ppm")]:
                    result = session.execute(text(
                        "SELECT value FROM sensor_readings WHERE sensor = :s ORDER BY timestamp DESC LIMIT 1"
                    ), {"s": sensor}).fetchone()
                    if result:
                        sensors[key] = result[0]
                
                if sensors:
                    automation_controller.update_sensors(sensors)
            time.sleep(1)
        except:
            time.sleep(1)

sensor_feeder = threading.Thread(target=_automation_sensor_feeder, daemon=True)
sensor_feeder.start()

# ML Prediction Module (lazy load on first use)
predictor = None

def get_predictor():
    """Lazy load ML predictor on first use."""
    global predictor
    if predictor is not None:
        return predictor
    
    try:
        ml_path = os.path.join(os.path.dirname(__file__), 'ML_MODEL_SUMMARY')
        spec = importlib.util.spec_from_file_location("predict_module", os.path.join(ml_path, '05_predict_new_data.py'))
        predict_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(predict_module)
        PlantGrowthPredictor = predict_module.PlantGrowthPredictor
        predictor = PlantGrowthPredictor(os.path.join(ml_path, 'training_data.csv'))
        print("[API] ML Predictor loaded successfully", flush=True)
        return predictor
    except Exception as e:
        print(f"[API] Could not load ML predictor: {e}", flush=True)
        return None


@app.route("/")
def home():
    return """
    <h1>Sensor API is running</h1>
    <p>Endpoints:</p>
    <ul>
        <li><a href="/api/readings">/api/readings</a> - All readings</li>
        <li><a href="/api/latest">/api/latest</a> - Latest per sensor</li>
        <li><a href="/api/db_status">/api/db_status</a> - DB status</li>
    </ul>
    """

@app.route("/api/db_status")
def db_status():
    try:
        with Session() as session:
            result = session.execute(text("SELECT COUNT(*) FROM sensor_readings")).scalar()
        return {"db_connected": True, "record_count": result}
    except Exception as e:
        return {"db_connected": False, "error": str(e)}


@app.route("/api/ingest", methods=["POST"])
def ingest():
    """Accept sensor readings from ESP32."""
    data = request.get_json(silent=True) or {}
    
    # Just return success - actual ingestion happens via ingest_serial.py
    # This endpoint exists for compatibility with ESP32 firmware
    return jsonify({"success": True, "message": "Use ingest_serial.py for ingestion"})


@app.route("/api/readings")
def get_readings():
    """Get latest sensor readings."""
    with Session() as session:
        result = session.execute(text("""
            SELECT sensor, value, unit, timestamp 
            FROM sensor_readings
            ORDER BY timestamp DESC
            LIMIT 100
        """)).fetchall()
    
    data = [{"sensor": r[0], "value": r[1], "unit": r[2], "timestamp": str(r[3])} for r in result]
    return jsonify(data)

@app.route("/api/latest")
def get_latest():
    """Get latest value per sensor (SQLite compatible)."""
    with Session() as session:
        # SQLite doesn't support DISTINCT ON, use GROUP BY instead
        result = session.execute(text("""
            SELECT sensor, value, unit, timestamp
            FROM sensor_readings
            WHERE (sensor, timestamp) IN (
                SELECT sensor, MAX(timestamp)
                FROM sensor_readings
                GROUP BY sensor
            )
            ORDER BY sensor
        """)).fetchall()
    
    data = {r[0]: {"value": r[1], "unit": r[2], "timestamp": str(r[3])} for r in result}
    return jsonify(data)


# ==================== RELAY CONTROL ====================
@app.route("/api/relay/pending")
def relay_pending():
    """ESP32 polls this to get relay states to apply."""
    # Return compact format for ESP32 (9 relays)
    states = "".join(["1" if RELAY_STATES[i] else "0" for i in range(1, 10)])
    return jsonify({"states": states})


@app.route("/api/relay/status")
def relay_status():
    """Get status of all relays."""
    return jsonify({
        "success": True,
        "relays": [
            {"id": i, "label": RELAY_LABELS.get(i, f"Relay {i}"), "state": RELAY_STATES[i]}
            for i in range(1, 10)  # 9 relays
        ]
    })


@app.route("/api/relay/<int:relay_id>/on", methods=["POST"])
def relay_on(relay_id):
    """Turn relay ON."""
    if relay_id < 1 or relay_id > 9:
        return jsonify({"success": False, "error": "Invalid relay ID"}), 400
    
    RELAY_STATES[relay_id] = True
    _save_relay_state(relay_id, True)
    
    return jsonify({
        "success": True,
        "relay": relay_id,
        "label": RELAY_LABELS.get(relay_id),
        "state": True
    })


@app.route("/api/relay/<int:relay_id>/off", methods=["POST"])
def relay_off(relay_id):
    """Turn relay OFF."""
    if relay_id < 1 or relay_id > 9:
        return jsonify({"success": False, "error": "Invalid relay ID"}), 400
    
    RELAY_STATES[relay_id] = False
    _save_relay_state(relay_id, False)
    
    return jsonify({
        "success": True,
        "relay": relay_id,
        "label": RELAY_LABELS.get(relay_id),
        "state": False
    })


@app.route("/api/relay/all/on", methods=["POST"])
def relay_all_on():
    """Turn all relays ON."""
    for i in range(1, 9):
        RELAY_STATES[i] = True
        _save_relay_state(i, True)
    
    return jsonify({"success": True, "message": "All relays ON"})


@app.route("/api/relay/all/off", methods=["POST"])
def relay_all_off():
    """Turn all relays OFF."""
    for i in range(1, 9):
        RELAY_STATES[i] = False
        _save_relay_state(i, False)
    
    return jsonify({"success": True, "message": "All relays OFF"})


# Alias endpoint for relay status (for frontend compatibility)
@app.route("/api/relays")
def relays_alias():
    return relay_status()


# ==================== OVERRIDE MODE ====================
@app.route("/api/override-mode", methods=["GET", "POST"])
def override_mode():
    """Get or set override mode (manual relay control)."""
    if request.method == "GET":
        return jsonify({"override_mode": automation_controller.override_mode})
    else:
        # POST to set override mode
        data = request.get_json(silent=True) or {}
        mode = data.get("mode", False)
        automation_controller.override_mode = mode
        return jsonify({"success": True, "override_mode": mode})


# ==================== ML PREDICTIONS ====================
@app.route("/api/predict", methods=["GET"])
def predict_growth():
    """Predict plant growth metrics based on latest sensor readings."""
    pred = get_predictor()
    if not pred:
        return jsonify({"success": False, "error": "ML predictor not available"}), 503
    
    try:
        # Get latest sensor readings
        with Session() as session:
            sensors = {}
            sensor_map = {
                "ph": "ph",
                "do": "do_mg_per_l",
                "tds": "tds_ppm",
                "temperature": "temperature_c",
                "humidity": "humidity"
            }
            
            for key, sensor_name in sensor_map.items():
                result = session.execute(text(
                    "SELECT value FROM sensor_readings WHERE sensor = :s ORDER BY timestamp DESC LIMIT 1"
                ), {"s": sensor_name}).fetchone()
                if result:
                    sensors[key] = float(result[0])
        
        # Validate we have sensor data
        if len(sensors) < 5:
            return jsonify({"success": False, "error": "Insufficient sensor data"}), 400
        
        # Get plant IDs from query params (default to plant 1 for both)
        plant_id_aero = int(request.args.get('plant_aero', 101))  # 101-106 for aeroponics
        plant_id_dwc = int(request.args.get('plant_dwc', 1))      # 1-6 for DWC
        
        # Make predictions for both farming methods
        pred_aero = pred.predict(
            ph=sensors.get('ph', 6.5),
            do=sensors.get('do', 5.0),
            tds=sensors.get('tds', 600),
            temp=sensors.get('temperature', 24),
            humidity=sensors.get('humidity', 60),
            plant_id=plant_id_aero
        )
        
        pred_dwc = pred.predict(
            ph=sensors.get('ph', 6.5),
            do=sensors.get('do', 5.0),
            tds=sensors.get('tds', 600),
            temp=sensors.get('temperature', 24),
            humidity=sensors.get('humidity', 60),
            plant_id=plant_id_dwc
        )
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sensors": sensors,
            "aeroponics": pred_aero,
            "dwc": pred_dwc
        })
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== PLANT HISTORY ====================
@app.route("/api/plant-history")
def plant_history():
    """Get historical plant measurement data for graphing."""
    try:
        plant_id = request.args.get('plant_id', '1')
        farming_system = request.args.get('farming_system', 'dwc')  # 'dwc' or 'aeroponics'
        metric = request.args.get('metric', 'height')  # height, weight, leaves, branches, length
        
        # Map metric names to database columns
        metric_map = {
            'height': 'height_cm',
            'weight': 'weight_g',
            'leaves': 'leaf_count',
            'branches': 'branch_count',
            'length': 'leaf_length_cm',
            'width': 'leaf_width_cm'
        }
        
        db_column = metric_map.get(metric, 'height_cm')
        
        # Convert plant_id to proper format (keep as int for database)
        if farming_system == 'aeroponics':
            # Aeroponics plants: 101-106
            db_plant_id = int(plant_id)
        else:
            # DWC plants: 1-6
            db_plant_id = int(plant_id)
        
        with Session() as session:
            result = session.execute(text(f"""
                SELECT DATE(timestamp) as date, {db_column} as value
                FROM plant_measurements
                WHERE plant_id = :plant_id
                AND {db_column} IS NOT NULL
                ORDER BY timestamp ASC
                LIMIT 30
            """), {"plant_id": db_plant_id}).fetchall()
        
        data = [{"date": str(row[0]), "value": float(row[1]) if row[1] else None} for row in result]
        
        return jsonify({
            "success": True,
            "plant_id": db_plant_id,
            "farming_system": farming_system,
            "metric": metric,
            "data": data,
            "count": len(data)
        })
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)