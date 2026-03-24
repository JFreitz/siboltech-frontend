#!/usr/bin/env python3
"""
Simple Flask API to serve sensor data from cloud DB.
Deploy on Railway, Vercel calls this for dashboard.
"""


import os
import requests
import csv
from datetime import datetime, timezone, timedelta
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
CALIBRATION_MODE = False

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
    <html>
    <head>
        <title>SIBOLTECH Sensor API</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
            h1 { color: #2c3e50; border-bottom: 3px solid #27ae60; padding-bottom: 10px; }
            .section { background: white; padding: 20px; margin: 20px 0; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .section h2 { color: #27ae60; margin-top: 0; }
            a { color: #3498db; text-decoration: none; }
            a:hover { text-decoration: underline; }
            button { background: #27ae60; color: white; border: none; padding: 10px 20px; margin: 5px; border-radius: 4px; cursor: pointer; font-size: 14px; }
            button:hover { background: #229954; }
            ul { line-height: 1.8; }
        </style>
    </head>
    <body>
        <h1>🌱 SIBOLTECH Sensor API</h1>
        
        <div class="section">
            <h2>📊 Data Endpoints</h2>
            <ul>
                <li><a href="/api/latest">/api/latest</a> - Latest sensor readings (JSON)</li>
                <li><a href="/api/readings">/api/readings</a> - All recent readings</li>
                <li><a href="/api/db_status">/api/db_status</a> - Database status</li>
                <li><a href="/api/relays">/api/relays</a> - Relay states</li>
            </ul>
        </div>
        
        <div class="section">
            <h2>⬇️ Data Export (CSV Download)</h2>
            <p><strong>ML Training Data</strong> (15-min sensor averages + plant measurements)</p>
            <button onclick="window.location.href='/api/export-ml-training'">⬇ Download ML Training CSV</button>
            
            <p><strong>Sensor + Actuator Data</strong> (sensor readings + relay states)</p>
            <button onclick="window.location.href='/api/export-sensor-actuator'">⬇ Download Sensor+Actuator CSV</button>
        </div>
        
        <div class="section">
            <h2>🤖 ML Prediction</h2>
            <ul>
                <li><a href="/api/predict">/api/predict</a> - Get plant growth predictions</li>
                <li><a href="/api/plant-history?plant_id=1&farming_system=dwc&metric=height">/api/plant-history</a> - Plant historical data</li>
            </ul>
        </div>
        
        <div class="section" style="background: #e8f5e9; border-left: 4px solid #27ae60;">
            <h2>✅ System Status</h2>
            <p>API is operational. Sensor data is being collected and synchronized to Firebase in real-time.</p>
        </div>
    </body>
    </html>
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
    """Ingest readings into local DB (used by firebase_sync serial thread and ESP32 HTTP uploads)."""
    payload = request.get_json(silent=True) or {}
    readings = payload.get("readings") or {}
    if not isinstance(readings, dict):
        return jsonify({"success": False, "error": "invalid readings"}), 400

    # Parse timestamp if provided, else use now
    ts = datetime.now(timezone.utc)
    raw_ts = payload.get("ts") or payload.get("timestamp")
    if raw_ts:
        try:
            ts = datetime.fromisoformat(str(raw_ts).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            pass

    # Compute calibrated values if only voltages are provided
    computed = dict(readings)
    try:
        if "ph" not in computed and "ph_voltage_v" in computed:
            from calibration import calibrate_ph
            computed["ph"] = float(calibrate_ph(float(computed["ph_voltage_v"])))
    except Exception:
        pass
    try:
        if "do_mg_per_l" not in computed and "do_voltage_v" in computed:
            from calibration import calibrate_do
            do_val = float(calibrate_do(float(computed["do_voltage_v"])))
            computed["do_mg_per_l"] = do_val
            computed["do_mg_l"] = do_val  # compatibility alias
    except Exception:
        pass
    try:
        # If TDS voltage is present, prefer calibrated TDS from local calibration.
        # This keeps live values aligned with calibration.json even when device sends raw/uncalibrated tds_ppm.
        if "tds_voltage_v" in computed:
            from calibration import calibrate_tds
            computed["tds_ppm"] = float(calibrate_tds(float(computed["tds_voltage_v"])))
    except Exception:
        pass

    allowed = {
        "temperature_c", "humidity", "tds_ppm",
        "ph", "do_mg_per_l", "do_mg_l",
        "ph_voltage_v", "do_voltage_v", "tds_voltage_v"
    }
    units = {
        "temperature_c": "C",
        "humidity": "%",
        "tds_ppm": "ppm",
        "ph": "pH",
        "do_mg_per_l": "mg/L",
        "do_mg_l": "mg/L",
        "ph_voltage_v": "V",
        "do_voltage_v": "V",
        "tds_voltage_v": "V",
    }

    to_insert = []
    for sensor_name, value in computed.items():
        if sensor_name not in allowed:
            continue
        try:
            v = float(value)
        except Exception:
            continue
        to_insert.append(
            SensorReading(
                timestamp=ts,
                sensor=str(sensor_name),
                value=v,
                unit=units.get(sensor_name),
                meta={"source": "http_ingest", "device": payload.get("device", "unknown")},
            )
        )

    with Session() as session:
        if to_insert:
            session.add_all(to_insert)
            session.commit()

    return jsonify({"success": True, "inserted": len(to_insert)})


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
    for i in range(1, 10):
        RELAY_STATES[i] = True
        _save_relay_state(i, True)
    
    return jsonify({"success": True, "message": "All relays ON"})


@app.route("/api/relay/all/off", methods=["POST"])
def relay_all_off():
    """Turn all relays OFF."""
    for i in range(1, 10):
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
        current = bool(automation_controller.override_mode)
        # Return both keys for backward compatibility with old/new clients
        return jsonify({"override_mode": current, "enabled": current})
    else:
        # POST to set override mode
        data = request.get_json(silent=True) or {}
        raw_mode = data.get("enabled", data.get("mode", False))
        if isinstance(raw_mode, str):
            mode = raw_mode.strip().lower() in {"1", "true", "on", "yes"}
        else:
            mode = bool(raw_mode)
        # Use controller method so internal reset/resync logic runs correctly
        automation_controller.set_override(mode)
        return jsonify({"success": True, "override_mode": mode, "enabled": mode})


@app.route("/api/calibration-mode", methods=["GET", "POST"])
def calibration_mode():
    """Get or set calibration mode for dashboard calibration workflow."""
    global CALIBRATION_MODE
    if request.method == "GET":
        return jsonify({"calibration_mode": CALIBRATION_MODE, "enabled": CALIBRATION_MODE})

    data = request.get_json(silent=True) or {}
    raw_mode = data.get("enabled", data.get("mode", False))
    if isinstance(raw_mode, str):
        mode = raw_mode.strip().lower() in {"1", "true", "on", "yes"}
    else:
        mode = bool(raw_mode)

    CALIBRATION_MODE = mode
    return jsonify({"success": True, "calibration_mode": CALIBRATION_MODE, "enabled": CALIBRATION_MODE})


# ==================== ML PREDICTIONS ====================


# ==================== TRAINING + GROWTH STATE ====================
def _normalize_farming_system(value: str) -> str:
    s = (value or "dwc").strip().lower()
    if s in {"aero", "aeroponics"}:
        return "aeroponics"
    if s in {"trad", "traditional"}:
        return "traditional"
    return "dwc"


def _map_plant_id_for_system(plant_id: int, farming_system: str) -> str:
    """Map Training tab plant IDs (1-6) to DB buckets by system."""
    fs = _normalize_farming_system(farming_system)
    if fs == "aeroponics":
        return str(100 + plant_id)
    if fs == "traditional":
        return str(200 + plant_id)
    return str(plant_id)


@app.route("/api/plant-reading", methods=["POST"])
def save_plant_reading():
    """Save one plant measurement row from Training tab."""
    try:
        data = request.get_json(silent=True) or {}

        plant_id_raw = data.get("plant_id")
        if plant_id_raw is None:
            return jsonify({"success": False, "error": "plant_id is required"}), 400

        try:
            plant_id = int(plant_id_raw)
        except Exception:
            return jsonify({"success": False, "error": "plant_id must be an integer"}), 400

        if plant_id < 1 or plant_id > 6:
            return jsonify({"success": False, "error": "plant_id must be between 1 and 6"}), 400

        farming_system = _normalize_farming_system(data.get("farming_system", "dwc"))
        mapped_plant_id = _map_plant_id_for_system(plant_id, farming_system)

        ts = datetime.now(timezone.utc)
        raw_ts = data.get("timestamp")
        if raw_ts:
            try:
                ts = datetime.fromisoformat(str(raw_ts).replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            except Exception:
                pass

        def _f(v):
            if v is None or v == "":
                return None
            try:
                return float(v)
            except Exception:
                return None

        height = _f(data.get("height"))
        weight = _f(data.get("weight"))
        length = _f(data.get("length"))
        width = _f(data.get("width"))
        leaves = _f(data.get("leaves"))
        branches = _f(data.get("branches"))

        with Session() as session:
            session.execute(text("""
                INSERT INTO plant_measurements (
                    timestamp, plant_id, height_cm, weight_g,
                    leaf_count, branch_count, leaf_length_cm, leaf_width_cm,
                    notes, measured_by
                ) VALUES (
                    :timestamp, :plant_id, :height_cm, :weight_g,
                    :leaf_count, :branch_count, :leaf_length_cm, :leaf_width_cm,
                    :notes, :measured_by
                )
            """), {
                "timestamp": ts,
                "plant_id": mapped_plant_id,
                "height_cm": height,
                "weight_g": weight,
                "leaf_count": leaves,
                "branch_count": branches,
                "leaf_length_cm": length,
                "leaf_width_cm": width,
                "notes": f"training-submit;system={farming_system}",
                "measured_by": "training-tab",
            })
            session.commit()

        return jsonify({
            "success": True,
            "plant_id": plant_id,
            "mapped_plant_id": mapped_plant_id,
            "farming_system": farming_system,
            "timestamp": ts.isoformat(),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/growth-comparison", methods=["GET"])
def growth_comparison():
    """Return daily averaged growth metric by system for Growth State graph."""
    try:
        metric = (request.args.get("metric") or "height").strip().lower()
        metric_map = {
            "height": "height_cm",
            "length": "leaf_length_cm",
            "weight": "weight_g",
            "width": "weight_g",   # frontend uses width button as weight in this view
            "leaves": "leaf_count",
            "branches": "branch_count",
        }
        if metric not in metric_map:
            return jsonify({"success": False, "error": f"Unsupported metric: {metric}"}), 400

        col = metric_map[metric]
        days_param = (request.args.get("days") or "14").strip().lower()

        # Prefer explicit Growth-State CSV files when present
        # (Aero-Growth-State.csv, DWC-Growth-State.csv, Trad-Growth-State.csv).
        def _csv_growth_payload():
            csv_metric_map = {
                "height": "height",
                "length": "length",
                "weight": "weight",
                "width": "weight",  # frontend width button maps to weight in this graph
                "leaves": "leaves",
                "branches": "branches",
            }
            csv_col = csv_metric_map.get(metric)
            if not csv_col:
                return None

            base_dir = os.path.dirname(__file__)
            files = {
                "aero": os.path.join(base_dir, "Aero-Growth-State.csv"),
                "dwc": os.path.join(base_dir, "DWC-Growth-State.csv"),
                "trad": os.path.join(base_dir, "Trad-Growth-State.csv"),
            }

            if not all(os.path.exists(p) for p in files.values()):
                return None

            cutoff_date = None
            if days_param != "all":
                try:
                    d = max(1, int(days_param))
                    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=d)).date()
                except Exception:
                    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=14)).date()

            by_system_date = {"aero": {}, "dwc": {}, "trad": {}}
            all_dates = set()

            for system_key, path in files.items():
                with open(path, "r", encoding="utf-8-sig", newline="") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        date_str = (row.get("date") or "").strip()
                        if not date_str:
                            continue
                        try:
                            d_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
                        except Exception:
                            continue
                        if cutoff_date and d_obj < cutoff_date:
                            continue

                        raw_val = row.get(csv_col)
                        if raw_val is None or str(raw_val).strip() == "":
                            continue
                        try:
                            val = float(raw_val)
                        except Exception:
                            continue

                        all_dates.add(date_str)
                        by_system_date[system_key].setdefault(date_str, []).append(val)

            if not all_dates:
                return {
                    "success": True,
                    "metric": metric,
                    "days": days_param,
                    "dates": [],
                    "aeroponic": [],
                    "dwc": [],
                    "traditional": [],
                    "unit": "count" if metric in {"leaves", "branches"} else ("g" if metric in {"weight", "width"} else "cm"),
                    "has_real_data": False,
                    "source": "growth_state_csv",
                }

            dates = sorted(all_dates)

            def avg_or_none(vals):
                return (sum(vals) / len(vals)) if vals else None

            aero = [avg_or_none(by_system_date["aero"].get(d, [])) for d in dates]
            dwc = [avg_or_none(by_system_date["dwc"].get(d, [])) for d in dates]
            trad = [avg_or_none(by_system_date["trad"].get(d, [])) for d in dates]

            unit_map = {
                "height": "cm",
                "length": "cm",
                "weight": "g",
                "width": "g",
                "leaves": "count",
                "branches": "count",
            }

            return {
                "success": True,
                "metric": metric,
                "days": days_param,
                "dates": dates,
                "aeroponic": aero,
                "dwc": dwc,
                "traditional": trad,
                "unit": unit_map.get(metric, "units"),
                "has_real_data": True,
                "source": "growth_state_csv",
            }

        csv_payload = _csv_growth_payload()
        if csv_payload is not None:
            return jsonify(csv_payload)

        if days_param == "all":
            cutoff = datetime(2000, 1, 1, tzinfo=timezone.utc)
        else:
            try:
                cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, int(days_param)))
            except Exception:
                cutoff = datetime.now(timezone.utc) - timedelta(days=14)

        with Session() as session:
            rows = session.execute(text(f"""
                SELECT
                    date(timestamp) AS d,
                    CASE
                        WHEN CAST(plant_id AS INTEGER) BETWEEN 1 AND 6 THEN 'dwc'
                        WHEN CAST(plant_id AS INTEGER) BETWEEN 101 AND 106 THEN 'aero'
                        WHEN CAST(plant_id AS INTEGER) BETWEEN 201 AND 206 THEN 'trad'
                        ELSE 'other'
                    END AS system,
                    AVG({col}) AS avg_val
                FROM plant_measurements
                WHERE timestamp >= :cutoff
                  AND {col} IS NOT NULL
                GROUP BY d, system
                HAVING system IN ('dwc', 'aero', 'trad')
                ORDER BY d ASC
            """), {"cutoff": cutoff}).fetchall()

        if not rows:
            return jsonify({
                "success": True,
                "metric": metric,
                "days": days_param,
                "dates": [],
                "aeroponic": [],
                "dwc": [],
                "traditional": [],
                "unit": "count" if metric in {"leaves", "branches"} else "cm",
                "has_real_data": False,
            })

        dates = sorted({str(r[0]) for r in rows})
        lookup = {(str(r[0]), str(r[1])): float(r[2]) for r in rows if r[2] is not None}

        aero = [lookup.get((d, "aero")) for d in dates]
        dwc = [lookup.get((d, "dwc")) for d in dates]
        trad = [lookup.get((d, "trad")) for d in dates]

        unit_map = {
            "height": "cm",
            "length": "cm",
            "weight": "g",
            "width": "g",
            "leaves": "count",
            "branches": "count",
        }

        return jsonify({
            "success": True,
            "metric": metric,
            "days": days_param,
            "dates": dates,
            "aeroponic": aero,
            "dwc": dwc,
            "traditional": trad,
            "unit": unit_map.get(metric, "units"),
            "has_real_data": True,
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


# ==================== DATA EXPORT ====================
@app.route("/api/export-ml-training", methods=["GET"])
def export_ml_training():
    """Export 15-minute averaged sensor data merged with plant readings for ML.
    
    Columns: timestamp, day, farming_system, ave_ph, ave_do, ave_tds,
             ave_temp, ave_humidity, Leaves, Branches, Weight, Length, Height
    """
    import io
    import csv as csv_mod
    from datetime import timedelta
    
    days_param = request.args.get('days', 'all')
    if days_param.lower() == 'all':
        cutoff = datetime(2000, 1, 1, tzinfo=timezone.utc)
    else:
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=int(days_param))
        except Exception:
            cutoff = datetime.now(timezone.utc) - timedelta(days=365)
    
    with Session() as session:
        # 15-minute averaged sensor readings
        sensor_rows = session.execute(text("""
            SELECT
                strftime('%Y-%m-%d %H:', timestamp) ||
                    SUBSTR('0' || CAST((CAST(strftime('%M', timestamp) AS INTEGER) / 15) * 15 AS TEXT), -2, 2) AS time_bucket,
                sensor,
                ROUND(AVG(value), 4) AS avg_value
            FROM sensor_readings
            WHERE sensor IN ('ph','tds_ppm','temperature_c','humidity')
            AND timestamp >= :cutoff
            GROUP BY time_bucket, sensor
            
            UNION ALL
            
            -- DO sensor: use do_mg_l for old data (before Mar 21) and do_mg_per_l for new data
            SELECT
                strftime('%Y-%m-%d %H:', timestamp) ||
                    SUBSTR('0' || CAST((CAST(strftime('%M', timestamp) AS INTEGER) / 15) * 15 AS TEXT), -2, 2) AS time_bucket,
                'do_mg_per_l' as sensor,
                ROUND(AVG(value), 4) AS avg_value
            FROM sensor_readings
            WHERE (sensor = 'do_mg_l' OR sensor = 'do_mg_per_l')
            AND timestamp >= :cutoff
            GROUP BY time_bucket
            
            ORDER BY time_bucket, sensor
        """), {"cutoff": cutoff}).fetchall()
        
        # All plant readings
        try:
            plant_rows = session.execute(text("""
                SELECT timestamp, plant_id, farming_system,
                       leaf_count, branch_count, weight_g, leaf_length_cm, height_cm
                FROM plant_measurements
                WHERE timestamp >= :cutoff
                ORDER BY timestamp
            """), {"cutoff": cutoff}).fetchall()
        except:
            plant_rows = []
    
    # Build sensor lookup
    sensor_lookup = {}
    all_buckets = []
    for row in sensor_rows:
        bucket = row[0]
        if bucket not in sensor_lookup:
            sensor_lookup[bucket] = {}
            all_buckets.append(bucket)
        sensor_lookup[bucket][row[1]] = row[2]
    
    # Build plant lookup
    plant_lookup = {}
    for row in plant_rows:
        ts_str = str(row[0])[:16]  # 'YYYY-MM-DD HH:MM'
        try:
            ts_dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M")
        except Exception:
            continue
        minute_bucket = (ts_dt.minute // 15) * 15
        bucket_key = f"{ts_dt.strftime('%Y-%m-%d %H:')}{minute_bucket:02d}"
        fs = row[2]
        key = (bucket_key, fs)
        # Keep latest per bucket+system
        plant_lookup[key] = {
            "Leaves": row[3] if row[3] is not None else "-",
            "Branches": row[4] if row[4] is not None else "-",
            "Weight": row[5] if row[5] is not None else "-",
            "Length": row[6] if row[6] is not None else "-",
            "Height": row[7] if row[7] is not None else "-",
        }
    
    # Calculate day numbers
    first_day = all_buckets[0][:10] if all_buckets else ""
    def day_num(bucket):
        try:
            d1 = datetime.strptime(first_day, "%Y-%m-%d")
            d2 = datetime.strptime(bucket[:10], "%Y-%m-%d")
            return (d2 - d1).days + 1
        except Exception:
            return 0
    
    farming_systems = ['aeroponics', 'dwc']
    headers = ['timestamp', 'day', 'farming_system',
               'ave_ph', 'ave_do', 'ave_tds', 'ave_temp', 'ave_humidity',
               'Leaves', 'Branches', 'Weight', 'Length', 'Height']
    
    csv_rows = []
    for bucket in all_buckets:
        sensors = sensor_lookup.get(bucket, {})
        for fs in farming_systems:
            plant = plant_lookup.get((bucket, fs), {})
            csv_rows.append({
                'timestamp': bucket,
                'day': day_num(bucket),
                'farming_system': fs,
                'ave_ph': sensors.get('ph', '-'),
                'ave_do': sensors.get('do_mg_per_l', '-'),
                'ave_tds': sensors.get('tds_ppm', '-'),
                'ave_temp': sensors.get('temperature_c', '-'),
                'ave_humidity': sensors.get('humidity', '-'),
                'Leaves': plant.get('Leaves', '-'),
                'Branches': plant.get('Branches', '-'),
                'Weight': plant.get('Weight', '-'),
                'Length': plant.get('Length', '-'),
                'Height': plant.get('Height', '-'),
            })
    
    output = io.StringIO()
    writer = csv_mod.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    writer.writerows(csv_rows)
    
    return app.response_class(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename=siboltech_ml_training_{datetime.now().strftime("%Y%m%d")}.csv'}
    )


@app.route("/api/export-sensor-actuator", methods=["GET"])
def export_sensor_actuator():
    """Export sensor readings + actuator states for accuracy checking.
    
    Builds a row per 15-min window with latest sensor values and relay states.
    """
    import io
    import csv as csv_mod
    from datetime import timedelta
    
    days_param = request.args.get('days', 'all')
    if days_param.lower() == 'all':
        cutoff = datetime(2000, 1, 1, tzinfo=timezone.utc)
    else:
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=int(days_param))
        except Exception:
            cutoff = datetime.now(timezone.utc) - timedelta(days=365)
    
    relay_labels = {
        1: 'Misting', 2: 'AirPump', 3: 'ExhaustIN', 4: 'ExhaustOUT',
        5: 'LightsAero', 6: 'LightsDWC', 7: 'pHUp', 8: 'pHDown', 9: 'LeafyGreen'
    }
    
    with Session() as session:
        # 15-min averaged sensor readings
        sensor_rows = session.execute(text("""
            SELECT
                strftime('%Y-%m-%d %H:', timestamp) ||
                    SUBSTR('0' || CAST((CAST(strftime('%M', timestamp) AS INTEGER) / 15) * 15 AS TEXT), -2, 2) AS time_bucket,
                sensor,
                ROUND(AVG(value), 4) AS avg_value
            FROM sensor_readings
            WHERE sensor IN ('ph','tds_ppm','temperature_c','humidity')
            AND timestamp >= :cutoff
            GROUP BY time_bucket, sensor
            
            UNION ALL
            
            -- DO sensor: use do_mg_l for old data (before Mar 21) and do_mg_per_l for new data
            SELECT
                strftime('%Y-%m-%d %H:', timestamp) ||
                    SUBSTR('0' || CAST((CAST(strftime('%M', timestamp) AS INTEGER) / 15) * 15 AS TEXT), -2, 2) AS time_bucket,
                'do_mg_per_l' as sensor,
                ROUND(AVG(value), 4) AS avg_value
            FROM sensor_readings
            WHERE (sensor = 'do_mg_l' OR sensor = 'do_mg_per_l')
            AND timestamp >= :cutoff
            GROUP BY time_bucket
            
            ORDER BY time_bucket, sensor
        """), {"cutoff": cutoff}).fetchall()
        
        # All actuator events
        act_rows = session.execute(text("""
            SELECT timestamp, relay_id, state
            FROM actuator_events
            WHERE timestamp >= :cutoff
            ORDER BY timestamp
        """), {"cutoff": cutoff}).fetchall()
    
    # Build sensor lookup
    sensor_lookup = {}
    all_buckets = []
    for row in sensor_rows:
        bucket = row[0]
        if bucket not in sensor_lookup:
            sensor_lookup[bucket] = {}
            all_buckets.append(bucket)
        sensor_lookup[bucket][row[1]] = row[2]
    
    # Build relay state timeline - track last known state for each relay in each bucket
    relay_state = {i: False for i in range(1, 10)}  # Default: all OFF
    relay_events_per_bucket = {}  # {bucket: {relay_id: state}}
    
    for row in act_rows:
        ts_str = str(row[0])[:16]
        try:
            ts_dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M")
        except Exception:
            continue
        minute_bucket = (ts_dt.minute // 15) * 15
        bucket_key = f"{ts_dt.strftime('%Y-%m-%d %H:')}{minute_bucket:02d}"
        
        relay_id = row[1]
        state = row[2]
        # state is either 1 (ON) or 0 (OFF), or possibly a string
        if isinstance(state, str):
            relay_state[relay_id] = (state.lower() == 'on' or state == '1')
        else:
            relay_state[relay_id] = (state == 1)
        
        if bucket_key not in relay_events_per_bucket:
            relay_events_per_bucket[bucket_key] = {}
        relay_events_per_bucket[bucket_key][relay_id] = relay_state[relay_id]
    
    # Build CSV rows
    headers = ['timestamp', 'ph', 'do_mg_l', 'tds_ppm', 'temperature_c', 'humidity']
    headers += [f'relay_{i}_{relay_labels[i]}' for i in range(1, 10)]
    
    csv_rows = []
    current_relay_state = {i: False for i in range(1, 10)}
    
    for bucket in all_buckets:
        # Update relay states if events happened in this bucket
        if bucket in relay_events_per_bucket:
            current_relay_state.update(relay_events_per_bucket[bucket])
        
        sensors = sensor_lookup.get(bucket, {})
        row_dict = {
            'timestamp': bucket,
            'ph': sensors.get('ph', '-'),
            'do_mg_l': sensors.get('do_mg_per_l', '-'),
            'tds_ppm': sensors.get('tds_ppm', '-'),
            'temperature_c': sensors.get('temperature_c', '-'),
            'humidity': sensors.get('humidity', '-'),
        }
        
        for i in range(1, 10):
            row_dict[f'relay_{i}_{relay_labels[i]}'] = 1 if current_relay_state[i] else 0
        
        csv_rows.append(row_dict)
    
    output = io.StringIO()
    writer = csv_mod.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    writer.writerows(csv_rows)
    
    return app.response_class(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename=siboltech_sensor_actuator_{datetime.now().strftime("%Y%m%d")}.csv'}
    )


# ==================== ML PREDICTIONS ====================
@app.route("/api/predict", methods=["POST"])
def predict_plant_growth():
    """
    Make ML predictions for plant growth metrics.
    
    Request body:
    {
        "date": "2026-03-23",  # YYYY-MM-DD format
        "plant_id": 1,
        "farming_system": "dwc",  # or "aeroponics"
        "actual_values": {  # Optional: actual measured values for comparison
            "height": 15.5,
            "length": 10.2,
            "weight": 120.3,
            "leaves": 45,
            "branches": 8
        }
    }
    """
    from ml_predictor import PlantGrowthPredictor
    
    try:
        data = request.get_json()
        date_str = data.get('date')
        requested_plant_id = int(data.get('plant_id', 6))
        plant_id = 6  # New ML flow predicts Plant 6 only
        farming_system = data.get('farming_system', 'dwc')
        actual_values = data.get('actual_values', {})
        manual_sensor_data = data.get('sensor_data') if isinstance(data.get('sensor_data'), dict) else None
        
        # Parse date
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            date_obj = date_obj.replace(tzinfo=timezone.utc)
        except Exception as e:
            return jsonify({"success": False, "error": f"Invalid date format: {e}"}), 400
        
        # Fetch average sensor readings for that date from local DB.
        # Use date(timestamp)=:date to handle stored timestamp formats consistently.
        date_only = date_obj.strftime("%Y-%m-%d")

        sensor_data = {}
        sensor_source = "daily_average"

        if manual_sensor_data:
            # Manual override from frontend
            try:
                sensor_data = {
                    'ave_ph': float(manual_sensor_data.get('ave_ph')),
                    'ave_do': float(manual_sensor_data.get('ave_do')),
                    'ave_tds': float(manual_sensor_data.get('ave_tds')),
                    'ave_temp': float(manual_sensor_data.get('ave_temp')),
                    'ave_humidity': float(manual_sensor_data.get('ave_humidity')),
                }
                sensor_source = "manual"
            except Exception:
                return jsonify({"success": False, "error": "Invalid manual sensor_data payload"}), 400
        else:
            sensor_map = {
                'ave_ph': ['ph'],
                'ave_do': ['do_mg_per_l', 'do_mg_l'],
                'ave_tds': ['tds_ppm'],
                'ave_temp': ['temperature_c'],
                'ave_humidity': ['humidity']
            }

            with Session() as session:
                for key, sensor_names in sensor_map.items():
                    if key == 'ave_do':
                        # Support both historical naming conventions for DO sensor
                        result = session.execute(text("""
                            SELECT AVG(value)
                            FROM sensor_readings
                            WHERE date(timestamp) = :date_only
                              AND sensor IN ('do_mg_per_l', 'do_mg_l')
                        """), {"date_only": date_only}).fetchone()
                    else:
                        result = session.execute(text("""
                            SELECT AVG(value)
                            FROM sensor_readings
                            WHERE date(timestamp) = :date_only
                              AND sensor = :sensor_name
                        """), {
                            "date_only": date_only,
                            "sensor_name": sensor_names[0]
                        }).fetchone()

                    if result and result[0] is not None:
                        sensor_data[key] = float(result[0])

            # If no sensor data found, use defaults
            if not sensor_data:
                sensor_data = {
                    'ave_ph': 6.5,
                    'ave_do': 5.0,
                    'ave_tds': 600,
                    'ave_temp': 24,
                    'ave_humidity': 60
                }
                sensor_source = "default"
        
        # Load predictor and make predictions
        predictor = PlantGrowthPredictor()
        if not predictor.is_available(farming_system):
            return jsonify({
                "success": False,
                "error": f"ML models not available for system: {farming_system}",
                "available": False
            }), 503
        
        predictions = predictor.predict(
            sensor_data=sensor_data,
            plant_id=plant_id,
            plant_system=farming_system,
            date_obj=date_obj
        )
        
        # Build response
        result = {
            "success": True,
            "date": date_str,
            "plant_id": plant_id,
            "requested_plant_id": requested_plant_id,
            "farming_system": farming_system,
            "sensor_data_used": sensor_data,
            "sensor_data_source": sensor_source,
            "predictions": predictions,
            "actual_values": actual_values if actual_values else None
        }
        
        # Calculate errors if actual values provided
        if actual_values:
            result["comparison"] = {}
            for metric in ["height", "length", "weight", "leaves", "branches"]:
                actual = actual_values.get(metric)
                predicted = predictions.get(metric)
                
                if actual is not None and predicted is not None:
                    error = abs(actual - predicted)
                    pct_error = (error / max(abs(actual), 0.001)) * 100
                    result["comparison"][metric] = {
                        "actual": actual,
                        "predicted": predicted,
                        "error": error,
                        "error_percent": pct_error
                    }
        
        # Save prediction to database
        try:
            from db import MLPrediction
            with Session() as session:
                pred_record = MLPrediction(
                    prediction_date=date_str,
                    plant_id=plant_id,
                    farming_system=farming_system,
                    sensor_data=sensor_data,
                    predictions=predictions,
                    actual_values=actual_values if actual_values else None,
                    comparison=result.get("comparison")
                )
                session.add(pred_record)
                session.commit()
        except Exception as e:
            print(f"[API] Failed to save prediction to DB: {e}", flush=True)
            # Don't fail the API call if we can't save, just log it
        
        return jsonify(result)
    
    except Exception as e:
        print(f"[API] Prediction error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/predictions/history", methods=["GET"])
def get_prediction_history():
    """Get all previous predictions, optionally filtered by plant_id."""
    try:
        from db import MLPrediction
        plant_id = request.args.get('plant_id', type=int)
        limit = request.args.get('limit', default=50, type=int)
        
        with Session() as session:
            query = session.query(MLPrediction).order_by(MLPrediction.timestamp.desc())
            
            if plant_id:
                query = query.filter(MLPrediction.plant_id == plant_id)
            
            predictions = query.limit(limit).all()
            
            result = []
            for pred in predictions:
                result.append({
                    "id": pred.id,
                    "timestamp": pred.timestamp.isoformat() if pred.timestamp else None,
                    "prediction_date": pred.prediction_date,
                    "plant_id": pred.plant_id,
                    "farming_system": pred.farming_system,
                    "sensor_data": pred.sensor_data,
                    "predictions": pred.predictions,
                    "actual_values": pred.actual_values,
                    "comparison": pred.comparison
                })
            
            return jsonify({
                "success": True,
                "count": len(result),
                "predictions": result
            })
    
    except Exception as e:
        print(f"[API] History error: {e}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)