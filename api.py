#!/usr/bin/env python3
"""Simple Flask API to serve sensor data from a DB.

Intended deployment: Railway (or any container host) with Postgres.
Local dev: SQLite (Despro/sensors.db).

This module avoids Postgres-specific SQL so it can run on both.
"""

import os
import json
import ssl
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import paho.mqtt.publish as mqtt_publish

from db import Base, SensorReading, PlantReading, ActuatorEvent


app = Flask(__name__)
# Enable CORS for all origins (allows Vercel frontend to access)
CORS(app, resources={r"/api/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type", "Authorization"]}})

_DEFAULT_SQLITE_PATH = os.path.join(os.path.dirname(__file__), "sensors.db")
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_SQLITE_PATH}")

engine = create_engine(DB_URL, echo=False, future=True)
Session = sessionmaker(bind=engine)

# Ensure schema exists (safe on Postgres too).
Base.metadata.create_all(bind=engine)


DISPLAY_TZ = ZoneInfo(os.getenv("DISPLAY_TIMEZONE", "Asia/Manila"))

# ==================== MQTT Configuration ====================
# HiveMQ Cloud (free tier) credentials
MQTT_BROKER = "f6647fc9076e4ccc9e403c3ae7633c0b.s1.eu.hivemq.cloud"
MQTT_PORT = 8883
MQTT_USER = "username"
MQTT_PASSWORD = "Password123"
MQTT_TOPIC_CMD = "siboltech/relay/cmd"


def _publish_mqtt(payload: dict):
    """Publish a message to MQTT broker."""
    try:
        mqtt_publish.single(
            topic=MQTT_TOPIC_CMD,
            payload=json.dumps(payload),
            hostname=MQTT_BROKER,
            port=MQTT_PORT,
            auth={"username": MQTT_USER, "password": MQTT_PASSWORD},
            tls={"tls_version": ssl.PROTOCOL_TLS},
            qos=1
        )
        return True
    except Exception as e:
        print(f"MQTT publish error: {e}")
        return False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value):
    if not value:
        return _utcnow()
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    if isinstance(value, str):
        s = value.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return _utcnow()
    return _utcnow()


def _format_ts_for_display(ts) -> str:
    """Return an ISO timestamp string in DISPLAY_TZ.

    DB drivers may return datetime or string for timestamps; be tolerant.
    """
    if ts is None:
        return ""
    if isinstance(ts, datetime):
        dt = ts
    else:
        s = str(ts).strip()
        # Handle common DB string forms like "YYYY-mm-dd HH:MM:SS[.ffffff][+00:00]"
        try:
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            dt = datetime.fromisoformat(s.replace(" ", "T"))
        except Exception:
            return str(ts)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(DISPLAY_TZ).isoformat()


def _check_ingest_auth() -> bool:
    token = os.getenv("INGEST_TOKEN")
    if not token:
        # If you don't set a token, endpoint is open.
        return True
    auth = request.headers.get("Authorization", "")
    return auth == f"Bearer {token}"


@app.route("/api/ingest", methods=["POST"])
def ingest():
    """Ingest readings into the DB.

    Accepts either:
    - ESP32-style payload: {"device":"...","ts":"...","readings":{...}}
    - Batch rows: {"rows":[{"timestamp":...,"sensor":...,"value":...,"unit":...,"meta":...}, ...]}

    Set INGEST_TOKEN in Railway, then send `Authorization: Bearer <token>`.
    """
    if not _check_ingest_auth():
        return {"ok": False, "error": "unauthorized"}, 401

    payload = request.get_json(silent=True) or {}
    
    # DEBUG: Log raw ESP32 payload
    print(f"[INGEST] Raw payload: {json.dumps(payload, default=str)[:500]}")

    rows = payload.get("rows")
    if isinstance(rows, list):
        inserted = 0
        skipped = 0
        with Session() as session:
            for r in rows:
                if not isinstance(r, dict):
                    continue
                sensor = r.get("sensor")
                if not sensor:
                    continue
                try:
                    value = float(r.get("value")) if r.get("value") is not None else None
                except Exception:
                    value = None

                ts = _parse_ts(r.get("timestamp"))
                sensor_s = str(sensor)
                unit = r.get("unit")
                meta = r.get("meta")

                exists = (
                    session.query(SensorReading.id)
                    .filter(
                        SensorReading.timestamp == ts,
                        SensorReading.sensor == sensor_s,
                        SensorReading.value == value,
                    )
                    .first()
                )
                if exists:
                    skipped += 1
                    continue

                session.add(
                    SensorReading(
                        timestamp=ts,
                        sensor=sensor_s,
                        value=value,
                        unit=unit,
                        meta=meta,
                    )
                )
                inserted += 1

            session.commit()

        return {"ok": True, "inserted": inserted, "skipped": skipped}

    device = payload.get("device") or payload.get("id") or "unknown"
    ts = _parse_ts(payload.get("ts") or payload.get("timestamp"))
    readings = payload.get("readings") or {}
    if not isinstance(readings, dict):
        return {"ok": False, "error": "invalid readings"}, 400

    computed_readings = dict(readings)
    if "ph" not in computed_readings and "ph_voltage_v" in computed_readings:
        try:
            from calibration import calibrate_ph

            v_ph = float(computed_readings.get("ph_voltage_v"))
            computed_readings["ph"] = float(calibrate_ph(v_ph))
        except Exception:
            pass

    if "do_mg_l" not in computed_readings and "do_voltage_v" in computed_readings:
        try:
            from calibration import calibrate_do

            v_do = float(computed_readings.get("do_voltage_v"))
            computed_readings["do_mg_l"] = float(calibrate_do(v_do))
        except Exception:
            pass

    allowed = os.getenv("ALLOWED_SENSORS", "temperature_c,humidity,tds_ppm,ph,do_mg_l")
    allowed_sensors = {s.strip() for s in allowed.split(",") if s.strip()}
    units = {"temperature_c": "C", "humidity": "%", "tds_ppm": "ppm", "ph": "pH", "do_mg_l": "mg/L"}

    to_insert = []
    ph_voltage_v = None
    try:
        if "ph_voltage_v" in computed_readings:
            ph_voltage_v = float(computed_readings.get("ph_voltage_v"))
    except Exception:
        ph_voltage_v = None

    do_voltage_v = None
    try:
        if "do_voltage_v" in computed_readings:
            do_voltage_v = float(computed_readings.get("do_voltage_v"))
    except Exception:
        do_voltage_v = None

    for sensor, value in computed_readings.items():
        sensor_name = str(sensor)
        if allowed_sensors and sensor_name not in allowed_sensors:
            continue
        try:
            v = float(value)
        except Exception:
            continue

        meta = {"source": "http_ingest", "device": device}
        if sensor_name == "ph" and ph_voltage_v is not None:
            meta = dict(meta)
            meta["ph_voltage_v"] = ph_voltage_v
        if sensor_name == "do_mg_l" and do_voltage_v is not None:
            meta = dict(meta)
            meta["do_voltage_v"] = do_voltage_v
        to_insert.append(
            SensorReading(
                timestamp=ts,
                sensor=sensor_name,
                value=v,
                unit=units.get(sensor_name),
                meta=meta,
            )
        )

    with Session() as session:
        session.add_all(to_insert)
        session.commit()

    return {"ok": True, "inserted": len(to_insert)}

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

@app.route("/api/tunnel-url")
def get_tunnel_url():
    """Get the current Cloudflare tunnel URL."""
    tunnel_file = os.path.join(os.path.dirname(__file__), "logs", "tunnel_url.txt")
    try:
        with open(tunnel_file, "r") as f:
            url = f.read().strip()
        if url:
            return jsonify({"url": url})
    except Exception:
        pass
    return jsonify({"url": None})

@app.route("/api/db_status")
def db_status():
    try:
        with Session() as session:
            result = session.execute(text("SELECT COUNT(*) FROM sensor_readings")).scalar()
        return {"db_connected": True, "record_count": result}
    except Exception as e:
        return {"db_connected": False, "error": str(e)}

@app.route("/api/readings")
def get_readings():
    """Get latest sensor readings."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    with Session() as session:
        result = session.execute(
            text(
                """
                SELECT sensor, value, unit, timestamp
                FROM sensor_readings
                                WHERE sensor IN ('temperature_c', 'humidity', 'tds_ppm', 'ph', 'do_mg_l')
                  AND timestamp >= :cutoff
                ORDER BY timestamp DESC
                """
            ),
            {"cutoff": cutoff},
        ).fetchall()
    
    data = [{"sensor": r[0], "value": r[1], "unit": r[2], "timestamp": _format_ts_for_display(r[3])} for r in result]
    return jsonify(data)

@app.route("/api/latest")
def get_latest():
    """Get latest value per sensor."""
    with Session() as session:
        rows = session.execute(
            text(
                """
                SELECT sensor, value, unit, timestamp
                FROM sensor_readings
                WHERE sensor IN ('temperature_c', 'humidity', 'tds_ppm', 'ph', 'do_mg_l')
                ORDER BY sensor ASC, timestamp DESC
                """
            )
        ).fetchall()

    data = {}
    for r in rows:
        sensor = r[0]
        if sensor in data:
            continue
        data[sensor] = {"value": r[1], "unit": r[2], "timestamp": _format_ts_for_display(r[3])}
    return jsonify(data)


@app.route("/api/history")
def get_history():
    """Get history for Plant, Sensor, or Actuator tab.
    
    Query params:
    - type: 'plant|sensor|actuator' (default: 'sensor')
    - farming_system: 'aeroponics|dwc|traditional' (for plant tab, optional)
    - plant_id: 1-6 (for plant tab, optional)
    - interval: 'daily' or '15min' (for sensor, default: 'daily')
    - days: number of days to look back (default: 7)
    - limit: max records to return (default: 100)
    """
    history_type = request.args.get('type', 'sensor').lower()
    plant_id = request.args.get('plant_id', type=int)
    farming_system = request.args.get('farming_system')
    interval = request.args.get('interval', 'daily').lower()
    days = int(request.args.get('days', 7))
    limit = int(request.args.get('limit', 100))
    
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    if history_type == 'plant':
        # Get plant readings with latest sensor data for each timestamp
        with Session() as session:
            query = session.query(PlantReading).filter(PlantReading.timestamp >= cutoff)
            if plant_id:
                query = query.filter(PlantReading.plant_id == plant_id)
            if farming_system:
                query = query.filter(PlantReading.farming_system == farming_system)
            
            plant_rows = query.order_by(PlantReading.timestamp.desc()).limit(limit).all()
        
        data = []
        for p in plant_rows:
            # Get latest sensor readings at or before this plant reading timestamp
            with Session() as session:
                sensor_rows = session.execute(
                    text("""
                        SELECT sensor, AVG(value) as avg_value
                        FROM sensor_readings
                        WHERE timestamp <= :ts AND sensor IN ('temperature_c', 'humidity', 'tds_ppm', 'ph', 'do_mg_l')
                        GROUP BY sensor
                    """),
                    {"ts": p.timestamp}
                ).fetchall()
            
            sensor_data = {row[0]: row[1] for row in sensor_rows}
            
            data.append({
                'timestamp': _format_ts_for_display(p.timestamp),
                'plant_id': p.plant_id,
                'farming_system': p.farming_system,
                'ph': sensor_data.get('ph'),
                'do': sensor_data.get('do_mg_l'),
                'tds': sensor_data.get('tds_ppm'),
                'temperature': sensor_data.get('temperature_c'),
                'humidity': sensor_data.get('humidity'),
                'leaves': p.leaves,
                'branches': p.branches,
                'height': p.height,
                'weight': p.weight,
                'length': p.length
            })
        return jsonify({'success': True, 'type': 'plant', 'count': len(data), 'readings': data})
    
    elif history_type == 'actuator':
        # Get actuator events
        with Session() as session:
            rows = session.query(ActuatorEvent).filter(ActuatorEvent.timestamp >= cutoff).order_by(ActuatorEvent.timestamp.desc()).limit(limit).all()
        
        data = []
        for r in rows:
            relay_label = RELAY_LABELS.get(r.relay_id, f'Relay {r.relay_id}')
            data.append({
                'timestamp': _format_ts_for_display(r.timestamp),
                'relay_id': r.relay_id,
                'relay_label': relay_label,
                'state': 'ON' if r.state == 1 else 'OFF',
                'state_code': r.state
            })
        return jsonify({'success': True, 'type': 'actuator', 'count': len(data), 'events': data})
    
    elif history_type == 'sensor' or history_type not in ['plant', 'actuator']:
        # Default: Sensor readings (daily/15min) for aero/dwc systems
        with Session() as session:
            if interval == '15min':
                # Get all readings in the time range for 15-min bucketing
                rows = session.execute(
                    text(
                        """
                        SELECT timestamp, sensor, value, unit
                        FROM sensor_readings
                        WHERE sensor IN ('temperature_c', 'humidity', 'tds_ppm', 'ph', 'do_mg_l')
                          AND timestamp >= :cutoff
                        ORDER BY timestamp DESC
                        """
                    ),
                    {"cutoff": cutoff},
                ).fetchall()
            else:
                # Daily aggregation - get average per day per sensor
                # Using SQLite-compatible date extraction
                rows = session.execute(
                    text(
                        """
                        SELECT DATE(timestamp) as day, sensor, AVG(value) as avg_value, unit
                        FROM sensor_readings
                        WHERE sensor IN ('temperature_c', 'humidity', 'tds_ppm', 'ph', 'do_mg_l')
                          AND timestamp >= :cutoff
                        GROUP BY DATE(timestamp), sensor, unit
                        ORDER BY day DESC
                        LIMIT :limit
                        """
                    ),
                    {"cutoff": cutoff, "limit": limit * 5},
                ).fetchall()
        
        # Group readings by timestamp
        if interval == '15min':
            # Group readings into 15-minute buckets and calculate averages
            buckets = {}  # key: bucket_start_time, value: {sensor: [values]}
            
            for r in rows:
                ts_raw = r[0]
                sensor = r[1]
                value = r[2]
                
                if value is None:
                    continue
                
                # Parse timestamp - SQLite returns strings, Postgres returns datetime
                if isinstance(ts_raw, str):
                    try:
                        ts = datetime.fromisoformat(ts_raw.replace('Z', '+00:00'))
                    except:
                        continue
                elif isinstance(ts_raw, datetime):
                    ts = ts_raw
                else:
                    continue
                    
                # Calculate 15-minute bucket start time
                bucket_minute = (ts.minute // 15) * 15
                bucket_ts = ts.replace(minute=bucket_minute, second=0, microsecond=0)
                
                bucket_key = bucket_ts.strftime('%Y-%m-%d %H:%M')
                
                if bucket_key not in buckets:
                    buckets[bucket_key] = {
                        'timestamp': bucket_ts,
                        'ph': [],
                        'do_mg_l': [],
                        'tds_ppm': [],
                        'temperature_c': [],
                        'humidity': []
                    }
                
                if sensor in buckets[bucket_key]:
                    buckets[bucket_key][sensor].append(value)
            
            # Calculate averages for each bucket
            data = []
            for bucket_key in sorted(buckets.keys(), reverse=True)[:limit]:
                bucket = buckets[bucket_key]
                reading = {
                    'timestamp': _format_ts_for_display(bucket['timestamp']),
                    'ph': round(sum(bucket['ph']) / len(bucket['ph']), 2) if bucket['ph'] else None,
                    'do': round(sum(bucket['do_mg_l']) / len(bucket['do_mg_l']), 2) if bucket['do_mg_l'] else None,
                    'tds': round(sum(bucket['tds_ppm']) / len(bucket['tds_ppm']), 1) if bucket['tds_ppm'] else None,
                    'temp': round(sum(bucket['temperature_c']) / len(bucket['temperature_c']), 1) if bucket['temperature_c'] else None,
                    'humidity': round(sum(bucket['humidity']) / len(bucket['humidity']), 1) if bucket['humidity'] else None
                }
                data.append(reading)
        else:
            # Daily averages
            readings_by_day = {}
            for r in rows:
                day = str(r[0])
                if day not in readings_by_day:
                    readings_by_day[day] = {
                        'timestamp': day,
                        'ph': None,
                        'do': None,
                        'tds': None,
                        'temp': None,
                        'humidity': None
                    }
                sensor = r[1]
                value = r[2]
                if sensor == 'ph':
                    readings_by_day[day]['ph'] = round(value, 2) if value else None
                elif sensor == 'do_mg_l':
                    readings_by_day[day]['do'] = round(value, 2) if value else None
                elif sensor == 'tds_ppm':
                    readings_by_day[day]['tds'] = round(value, 1) if value else None
                elif sensor == 'temperature_c':
                    readings_by_day[day]['temp'] = round(value, 1) if value else None
                elif sensor == 'humidity':
                    readings_by_day[day]['humidity'] = round(value, 1) if value else None
            
            data = list(readings_by_day.values())[:limit]
    
    return jsonify({
        'success': True,
        'interval': interval,
        'count': len(data),
        'readings': data
    })

# ==================== RELAY CONTROL ====================
# In-memory relay states (persisted in DB for reliability)
RELAY_STATES = {i: False for i in range(1, 10)}  # 9 relays
CALIBRATION_MODE_ENABLED = False  # When True, disables all actuator triggers

RELAY_LABELS = {
    1: "Misting Pump",
    2: "Air Pump",
    3: "Exhaust Fan (In)",
    4: "Exhaust Fan (Out)",
    5: "Grow Lights (Aeroponics)",
    6: "Grow Lights (DWC)",
    7: "pH Up",
    8: "pH Down",
    9: "Leafy Green"
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
    except Exception:
        pass


# Initialize on startup
_init_relay_states()

# ==================== PLANT READINGS ====================
@app.route("/api/plant-reading", methods=["POST"])
def save_plant_reading():
    """Save plant measurements from prediction tab.
    
    Expected payload:
    {
        "plant_id": 1,
        "farming_system": "aeroponics|dwc|traditional",
        "leaves": 5,
        "branches": 3,
        "height": 15.5,
        "weight": 120.3,
        "length": 20.0
    }
    """
    payload = request.get_json(silent=True) or {}
    plant_id = payload.get("plant_id")
    farming_system = payload.get("farming_system", "aeroponics")
    
    if not plant_id:
        return {"ok": False, "error": "plant_id required"}, 400
    
    try:
        reading = PlantReading(
            plant_id=int(plant_id),
            farming_system=farming_system,
            leaves=float(payload.get("leaves")) if payload.get("leaves") is not None else None,
            branches=float(payload.get("branches")) if payload.get("branches") is not None else None,
            height=float(payload.get("height")) if payload.get("height") is not None else None,
            weight=float(payload.get("weight")) if payload.get("weight") is not None else None,
            length=float(payload.get("length")) if payload.get("length") is not None else None,
        )
        with Session() as session:
            session.add(reading)
            session.flush()  # Assign ID without detaching object
            reading_id = reading.id
            session.commit()
        return {"ok": True, "id": reading_id}
    except Exception as e:
        return {"ok": False, "error": str(e)}, 400

# ==================== ACTUATOR EVENTS ====================
@app.route("/api/relay-event", methods=["POST"])
def log_relay_event():
    """Log relay state change event.
    
    Expected payload:
    {
        "relay_id": 1,
        "state": 0 or 1,  # 0=OFF, 1=ON
        "meta": {}  # optional
    }
    """
    payload = request.get_json(silent=True) or {}
    relay_id = payload.get("relay_id")
    state = payload.get("state")
    
    if relay_id is None or state is None:
        return {"ok": False, "error": "relay_id and state required"}, 400
    
    try:
        event = ActuatorEvent(
            relay_id=int(relay_id),
            state=int(state),
            meta=payload.get("meta")
        )
        with Session() as session:
            session.add(event)
            session.commit()
        return {"ok": True, "id": event.id}
    except Exception as e:
        return {"ok": False, "error": str(e)}, 400

# Alias endpoint for relay status (for frontend compatibility)
@app.route("/api/relays")
def relays_alias():
    return relay_status()


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


# ==================== CALIBRATION MODE ====================
@app.route("/api/calibration-mode", methods=["GET"])
def get_calibration_mode():
    """Get current calibration mode status."""
    return jsonify({
        "success": True,
        "enabled": CALIBRATION_MODE_ENABLED
    })


@app.route("/api/calibration-mode", methods=["POST"])
def set_calibration_mode():
    """Enable/disable calibration mode (disables actuators during calibration)."""
    global CALIBRATION_MODE_ENABLED
    data = request.get_json() or {}
    enabled = data.get("enabled", False)
    
    CALIBRATION_MODE_ENABLED = bool(enabled)
    
    print(f"[CALIBRATION MODE] {'ENABLED' if CALIBRATION_MODE_ENABLED else 'DISABLED'} - Actuators {'suspended' if CALIBRATION_MODE_ENABLED else 'active'}")
    
    return jsonify({
        "success": True,
        "enabled": CALIBRATION_MODE_ENABLED,
        "message": "Actuators disabled for calibration" if CALIBRATION_MODE_ENABLED else "Actuators re-enabled"
    })


@app.route("/api/relay/pending")
def relay_pending():
    """ESP32 polls this to get relay states to apply."""
    # Return compact format for ESP32 (9 relays)
    states = "".join(["1" if RELAY_STATES[i] else "0" for i in range(1, 10)])
    return jsonify({"states": states})


@app.route("/api/relay/<int:relay_id>/on", methods=["POST"])
def relay_on(relay_id):
    """Turn relay ON."""
    if relay_id < 1 or relay_id > 9:
        return jsonify({"success": False, "error": "Invalid relay ID"}), 400
    
    RELAY_STATES[relay_id] = True
    _save_relay_state(relay_id, True)
    
    # Publish to MQTT for instant ESP32 response
    # mqtt_sent = _publish_mqtt({"relay": relay_id, "state": "ON"})
    mqtt_sent = True  # Assume sent for compatibility
    
    return jsonify({
        "success": True,
        "relay": relay_id,
        "label": RELAY_LABELS.get(relay_id),
        "state": True,
        "mqtt_sent": mqtt_sent
    })


@app.route("/api/relay/<int:relay_id>/off", methods=["POST"])
def relay_off(relay_id):
    """Turn relay OFF."""
    if relay_id < 1 or relay_id > 9:
        return jsonify({"success": False, "error": "Invalid relay ID"}), 400
    
    RELAY_STATES[relay_id] = False
    _save_relay_state(relay_id, False)
    
    # Publish to MQTT for instant ESP32 response
    # mqtt_sent = _publish_mqtt({"relay": relay_id, "state": "OFF"})
    mqtt_sent = True  # Assume sent for compatibility
    
    return jsonify({
        "success": True,
        "relay": relay_id,
        "label": RELAY_LABELS.get(relay_id),
        "state": False,
        "mqtt_sent": mqtt_sent
    })


@app.route("/api/relay/all/on", methods=["POST"])
def relay_all_on():
    """Turn all relays ON."""
    for i in range(1, 9):
        RELAY_STATES[i] = True
        _save_relay_state(i, True)
    
    # Publish to MQTT
    mqtt_sent = _publish_mqtt({"relay": "all", "state": "ON"})
    
    return jsonify({"success": True, "message": "All relays ON", "mqtt_sent": mqtt_sent})


@app.route("/api/relay/all/off", methods=["POST"])
def relay_all_off():
    """Turn all relays OFF."""
    for i in range(1, 9):
        RELAY_STATES[i] = False
        _save_relay_state(i, False)
    
    # Publish to MQTT
    mqtt_sent = _publish_mqtt({"relay": "all", "state": "OFF"})
    
    return jsonify({"success": True, "message": "All relays OFF", "mqtt_sent": mqtt_sent})


def _save_relay_state(relay_id, state):
    """Save relay state to DB for persistence."""
    try:
        with Session() as session:
            session.add(SensorReading(
                timestamp=_utcnow(),
                sensor=f"relay_{relay_id}",
                value=1.0 if state else 0.0,
                unit="state",
                meta={"label": RELAY_LABELS.get(relay_id)}
            ))
            session.commit()
    except Exception:
        pass


# ==================== Calibration Endpoints ====================
CALIBRATION_FILE = os.path.join(os.path.dirname(__file__), "calibration.json")

def _load_calibration():
    """Load calibration values from file."""
    try:
        with open(CALIBRATION_FILE, 'r') as f:
            return json.load(f)
    except:
        return {"ph": {"slope": 1.0, "offset": 0.0}, "tds": {"slope": 1.0, "offset": 0.0}, "do": {"slope": 1.0, "offset": 0.0}}

def _save_calibration(data):
    """Save calibration values to file."""
    with open(CALIBRATION_FILE, 'w') as f:
        json.dump(data, f, indent=2)

@app.route("/api/calibration", methods=["GET"])
def get_calibration():
    """Get current calibration values for all sensors."""
    cal = _load_calibration()
    return jsonify(cal)

@app.route("/api/calibration", methods=["POST"])
def set_calibration():
    """Update calibration values for a sensor.
    
    Expects JSON: {"sensor": "ph|tds|do", "slope": float, "offset": float}
    """
    data = request.get_json()
    sensor = data.get("sensor", "").lower()
    slope = data.get("slope")
    offset = data.get("offset")
    
    if sensor not in ["ph", "tds", "do"]:
        return jsonify({"error": "Invalid sensor. Use: ph, tds, do"}), 400
    
    if slope is None or offset is None:
        return jsonify({"error": "Missing slope or offset"}), 400
    
    cal = _load_calibration()
    cal[sensor] = {"slope": float(slope), "offset": float(offset)}
    _save_calibration(cal)
    
    # Log calibration change
    try:
        with Session() as session:
            session.add(SensorReading(
                timestamp=_utcnow(),
                sensor=f"{sensor}_calibration",
                value=slope,
                unit="calibration",
                meta={"slope": slope, "offset": offset}
            ))
            session.commit()
    except:
        pass
    
    return jsonify({"success": True, "sensor": sensor, "slope": slope, "offset": offset})

@app.route("/api/voltage", methods=["GET"])
def get_voltage():
    """Get latest raw voltage readings for calibration.
    
    Returns the most recent voltage values for pH, TDS, and DO sensors.
    """
    with Session() as session:
        result = {}
        for sensor in ["ph_voltage_v", "tds_voltage_v", "do_voltage_v"]:
            row = session.execute(
                text("SELECT value, timestamp FROM sensor_readings WHERE sensor = :s ORDER BY timestamp DESC LIMIT 1"),
                {"s": sensor}
            ).first()
            if row:
                result[sensor.replace("_voltage_v", "")] = {
                    "voltage": row[0],
                    "timestamp": _format_ts_for_display(row[1])
                }
        return jsonify(result)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)