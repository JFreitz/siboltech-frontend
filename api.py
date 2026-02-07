#!/usr/bin/env python3
"""Simple Flask API to serve sensor data from a DB.

Intended deployment: Railway (or any container host) with Postgres.
Local dev: SQLite (Despro/sensors.db).

This module avoids Postgres-specific SQL so it can run on both.
"""

import os
import json
import ssl
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import paho.mqtt.publish as mqtt_publish
import serial

from db import Base, SensorReading, PlantReading, ActuatorEvent
from automation import init_controller, get_controller


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

# ==================== Serial Configuration ====================
def _detect_serial_port():
    """Auto-detect ESP32 serial port."""
    import glob
    env_port = os.getenv("SERIAL_PORT")
    if env_port:
        return env_port
    # Try common ports in order
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
        ports = sorted(glob.glob(pattern))
        if ports:
            print(f"[SERIAL] Auto-detected port: {ports[0]}", flush=True)
            return ports[0]
    return "/dev/ttyUSB0"  # fallback

SERIAL_PORT = _detect_serial_port()
SERIAL_BAUD = 115200
_serial_lock = threading.Lock()
_serial_conn = None


# ==================== Serial Log Ring Buffer ====================
from collections import deque
import time as _time

_serial_log = deque(maxlen=200)  # Keep last 200 lines
_serial_log_lock = threading.Lock()


def _serial_log_append(line: str):
    """Thread-safe append to serial log."""
    ts = datetime.now(DISPLAY_TZ).strftime('%H:%M:%S')
    with _serial_log_lock:
        _serial_log.append(f"[{ts}] {line}")


def _serial_reader_thread():
    """Background thread that reads ESP32 serial output into the log buffer.
    Only reads when the serial port is not busy with other services."""
    import time
    print("[SERIAL-LOG] Reader thread started", flush=True)
    while True:
        try:
            acquired = _serial_lock.acquire(timeout=0.1)
            if not acquired:
                time.sleep(0.1)
                continue
            try:
                ser = _get_serial()
                if ser and ser.in_waiting:
                    raw = ser.readline()
                    if raw:
                        line = raw.decode('utf-8', errors='ignore').strip()
                        # Filter out binary garbage (non-printable characters)
                        if line and all(c == '\n' or c == '\r' or (32 <= ord(c) < 127) for c in line):
                            _serial_log_append(line)
            finally:
                _serial_lock.release()
            time.sleep(0.05)
        except Exception:
            time.sleep(3)


def _get_serial():
    """Get or create serial connection to ESP32."""
    global _serial_conn
    try:
        if _serial_conn is None or not _serial_conn.is_open:
            _serial_conn = serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=1)
            import time
            time.sleep(0.3)  # Wait for connection to stabilize
            _serial_conn.reset_input_buffer()
        return _serial_conn
    except Exception as e:
        print(f"Serial connection error: {e}")
        return None


def _send_serial_command(cmd: str) -> dict:
    """Send command to ESP32 via serial and return response."""
    import time
    with _serial_lock:
        try:
            ser = _get_serial()
            if not ser:
                return {"success": False, "error": "Serial not available"}
            
            # Clear buffers - discard any pending sensor data
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            time.sleep(0.02)  # Small delay to ensure buffer is cleared
            ser.reset_input_buffer()  # Clear again after any queued data arrives
            
            # Send command
            ser.write((cmd + "\n").encode())
            ser.flush()
            
            # Wait for ESP32 to process
            time.sleep(0.1)
            
            # Read response - only look for relay-related JSON
            response_lines = []
            start = time.time()
            while (time.time() - start) < 0.5:
                if ser.in_waiting:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        # Only capture relay-related responses
                        if '"relay"' in line or '"relay_status"' in line or '"all_relays"' in line:
                            response_lines.append(line)
                            break  # Got our response
                else:
                    time.sleep(0.01)
            
            print(f"[Serial] Sent: {cmd} | Response: {response_lines}")
            return {"success": True, "response": response_lines}
        except Exception as e:
            print(f"Serial command error: {e}")
            return {"success": False, "error": str(e)}


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
    
    # Also log to serial console for visibility
    readings_summary = payload.get("readings", {})
    if isinstance(readings_summary, dict) and readings_summary:
        parts = [f"{k}={v:.2f}" if isinstance(v, float) else f"{k}={v}" for k, v in readings_summary.items()]
        _serial_log_append(f"[INGEST] {payload.get('device','?')}: {', '.join(parts[:6])}")

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

    tds_voltage_v = None
    try:
        if "tds_voltage_v" in computed_readings:
            tds_voltage_v = float(computed_readings.get("tds_voltage_v"))
    except Exception:
        tds_voltage_v = None

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
        if sensor_name == "tds_ppm" and tds_voltage_v is not None:
            meta = dict(meta)
            meta["tds_voltage_v"] = tds_voltage_v
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

    # Feed sensor data to automation controller
    try:
        controller = get_controller()
        if controller:
            print(f"[DEBUG] Feeding to automation: do_mg_l={computed_readings.get('do_mg_l')}, ph={computed_readings.get('ph')}", flush=True)
            controller.update_sensors(computed_readings)
    except Exception as e:
        print(f"[AUTOMATION] Failed to update sensors: {e}")

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
        # Plant history: sensor averages per interval + plant measurements
        with Session() as session:
            # --- Sensor averages bucketed by interval ---
            if interval == 'daily':
                sensor_rows = session.execute(
                    text("""
                        SELECT DATE(timestamp) as bucket, sensor, AVG(value) as avg_value
                        FROM sensor_readings
                        WHERE sensor IN ('temperature_c', 'humidity', 'tds_ppm', 'ph', 'do_mg_l')
                          AND timestamp >= :cutoff
                        GROUP BY DATE(timestamp), sensor
                        ORDER BY bucket DESC
                    """),
                    {"cutoff": cutoff}
                ).fetchall()
            else:
                # Raw readings for 15-min bucketing in Python
                sensor_rows = session.execute(
                    text("""
                        SELECT timestamp, sensor, value
                        FROM sensor_readings
                        WHERE sensor IN ('temperature_c', 'humidity', 'tds_ppm', 'ph', 'do_mg_l')
                          AND timestamp >= :cutoff
                        ORDER BY timestamp DESC
                    """),
                    {"cutoff": cutoff}
                ).fetchall()

            # --- Plant readings ---
            pquery = session.query(PlantReading).filter(PlantReading.timestamp >= cutoff)
            if plant_id:
                pquery = pquery.filter(PlantReading.plant_id == plant_id)
            if farming_system:
                pquery = pquery.filter(PlantReading.farming_system == farming_system)
            plant_rows = pquery.order_by(PlantReading.timestamp.desc()).limit(limit).all()

        # Build sensor buckets
        sensor_buckets = {}  # key -> {ph: [], do: [], ...}
        sensor_map = {'ph': 'ph', 'do_mg_l': 'do', 'tds_ppm': 'tds', 'temperature_c': 'temperature', 'humidity': 'humidity'}

        if interval == 'daily':
            for row in sensor_rows:
                bucket_key = str(row[0])  # DATE string
                if bucket_key not in sensor_buckets:
                    sensor_buckets[bucket_key] = {'ph': None, 'do': None, 'tds': None, 'temperature': None, 'humidity': None, 'timestamp': bucket_key}
                mapped = sensor_map.get(row[1])
                if mapped:
                    sensor_buckets[bucket_key][mapped] = round(row[2], 2) if row[2] is not None else None
        else:
            # 15-min bucketing
            for row in sensor_rows:
                ts = row[0]
                if isinstance(ts, str):
                    try:
                        ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                    except:
                        continue
                bucket_minute = (ts.minute // 15) * 15
                bucket_ts = ts.replace(minute=bucket_minute, second=0, microsecond=0)
                bucket_key = bucket_ts.strftime('%Y-%m-%d %H:%M')
                if bucket_key not in sensor_buckets:
                    sensor_buckets[bucket_key] = {'ph': [], 'do': [], 'tds': [], 'temperature': [], 'humidity': [], 'timestamp': bucket_ts}
                mapped = sensor_map.get(row[1])
                if mapped and row[2] is not None:
                    sensor_buckets[bucket_key][mapped].append(row[2])

            # Average the 15-min buckets
            for bk in sensor_buckets:
                b = sensor_buckets[bk]
                for field in ['ph', 'do', 'tds', 'temperature', 'humidity']:
                    vals = b[field]
                    b[field] = round(sum(vals) / len(vals), 2) if vals else None

        # Attach plant readings to the nearest bucket
        plant_by_bucket = {}
        for p in plant_rows:
            pts = p.timestamp
            if isinstance(pts, str):
                try:
                    pts = datetime.fromisoformat(pts.replace('Z', '+00:00'))
                except:
                    continue
            if interval == 'daily':
                bk = pts.strftime('%Y-%m-%d')
            else:
                bm = (pts.minute // 15) * 15
                bk = pts.replace(minute=bm, second=0, microsecond=0).strftime('%Y-%m-%d %H:%M')
            if bk not in plant_by_bucket:
                plant_by_bucket[bk] = p  # keep first (latest since desc order)

        # Merge: every sensor bucket becomes a row; add plant data if available
        data = []
        for bk in sorted(sensor_buckets.keys(), reverse=True)[:limit]:
            sb = sensor_buckets[bk]
            p = plant_by_bucket.get(bk)
            data.append({
                'timestamp': _format_ts_for_display(sb['timestamp']) if not isinstance(sb['timestamp'], str) else sb['timestamp'],
                'plant_id': p.plant_id if p else None,
                'farming_system': p.farming_system if p else (farming_system or ''),
                'ph': sb['ph'],
                'do': sb['do'],
                'tds': sb['tds'],
                'temperature': sb['temperature'],
                'humidity': sb['humidity'],
                'leaves': p.leaves if p else None,
                'branches': p.branches if p else None,
                'height': p.height if p else None,
                'weight': p.weight if p else None,
                'length': p.length if p else None,
            })
        return jsonify({'success': True, 'type': 'plant', 'interval': interval, 'count': len(data), 'readings': data})
    
    elif history_type == 'actuator':
        # Get actuator events - bucket by interval (daily or 15min)
        with Session() as session:
            rows = session.query(ActuatorEvent).filter(
                ActuatorEvent.timestamp >= cutoff
            ).order_by(ActuatorEvent.timestamp.desc()).limit(limit * 10).all()
        
        # Also get sensor readings for the same time period
        sensor_rows = []
        with Session() as session:
            sensor_rows = session.execute(
                text("""
                    SELECT timestamp, sensor, value
                    FROM sensor_readings
                    WHERE timestamp >= :cutoff
                      AND sensor IN ('temperature_c', 'humidity', 'tds_ppm', 'ph', 'do_mg_l')
                    ORDER BY timestamp DESC
                """),
                {"cutoff": cutoff}
            ).fetchall()
        
        # Bucket actuator events
        buckets = {}  # key: bucket_start_time str, value: {relay_events: [...], sensors: {...}}
        
        for r in rows:
            ts = r.timestamp
            if isinstance(ts, str):
                try:
                    ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                except:
                    continue
            
            if interval == '15min':
                bucket_minute = (ts.minute // 15) * 15
                bucket_ts = ts.replace(minute=bucket_minute, second=0, microsecond=0)
            else:
                bucket_ts = ts.replace(hour=0, minute=0, second=0, microsecond=0)
            
            bucket_key = bucket_ts.isoformat()
            
            if bucket_key not in buckets:
                buckets[bucket_key] = {
                    'timestamp': bucket_ts,
                    'relay_events': [],
                    'ph': [], 'do': [], 'tds': [], 'temperature': [], 'humidity': []
                }
            
            # Add relay event (dedupe by relay_id - keep latest state)
            existing = [e for e in buckets[bucket_key]['relay_events'] if e['relay_id'] == r.relay_id]
            if not existing:
                buckets[bucket_key]['relay_events'].append({
                    'relay_id': r.relay_id,
                    'state': r.state
                })
        
        # Add sensor data to buckets
        for sr in sensor_rows:
            ts = sr[0]
            if isinstance(ts, str):
                try:
                    ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                except:
                    continue
            
            if interval == '15min':
                bucket_minute = (ts.minute // 15) * 15
                bucket_ts = ts.replace(minute=bucket_minute, second=0, microsecond=0)
            else:
                bucket_ts = ts.replace(hour=0, minute=0, second=0, microsecond=0)
            
            bucket_key = bucket_ts.isoformat()
            if bucket_key in buckets:
                sensor = sr[1]
                value = sr[2]
                if sensor == 'ph':
                    buckets[bucket_key]['ph'].append(value)
                elif sensor == 'do_mg_l':
                    buckets[bucket_key]['do'].append(value)
                elif sensor == 'tds_ppm':
                    buckets[bucket_key]['tds'].append(value)
                elif sensor == 'temperature_c':
                    buckets[bucket_key]['temperature'].append(value)
                elif sensor == 'humidity':
                    buckets[bucket_key]['humidity'].append(value)
        
        # Build final data
        data = []
        for bucket_key in sorted(buckets.keys(), reverse=True)[:limit]:
            bucket = buckets[bucket_key]
            data.append({
                'timestamp': _format_ts_for_display(bucket['timestamp']),
                'relay_events': bucket['relay_events'],
                'ph': round(sum(bucket['ph']) / len(bucket['ph']), 2) if bucket['ph'] else None,
                'do': round(sum(bucket['do']) / len(bucket['do']), 2) if bucket['do'] else None,
                'tds': round(sum(bucket['tds']) / len(bucket['tds']), 1) if bucket['tds'] else None,
                'temperature': round(sum(bucket['temperature']) / len(bucket['temperature']), 1) if bucket['temperature'] else None,
                'humidity': round(sum(bucket['humidity']) / len(bucket['humidity']), 1) if bucket['humidity'] else None
            })
        
        return jsonify({'success': True, 'type': 'actuator', 'interval': interval, 'count': len(data), 'readings': data})
    
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
                    'temperature': round(sum(bucket['temperature_c']) / len(bucket['temperature_c']), 1) if bucket['temperature_c'] else None,
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
                        'temperature': None,
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
                    readings_by_day[day]['temperature'] = round(value, 1) if value else None
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
OVERRIDE_MODE_ENABLED = False  # When True, disables automation (manual control)

# ==================== AUTOMATION CONTROLLER ====================
def _automation_relay_callback(relay_id: int, state: bool):
    """Callback for automation controller to set relay states."""
    global RELAY_STATES
    label = RELAY_LABELS.get(relay_id, f"Relay {relay_id}")
    # Reject None or non-bool values
    if state is None:
        return
    state = bool(state)
    if OVERRIDE_MODE_ENABLED or CALIBRATION_MODE_ENABLED:
        return  # Don't change relays in override or calibration mode
    prev = RELAY_STATES.get(relay_id)
    RELAY_STATES[relay_id] = state
    if prev != state:
        # State actually changed — save to DB and log
        _save_relay_state(relay_id, state)
        _serial_log_append(f"[AUTO] {label} -> {'ON' if state else 'OFF'}")
        print(f"[CALLBACK] {label} (R{relay_id}) -> {'ON' if state else 'OFF'}", flush=True)

# Initialize automation controller (starts background thread)
_automation_controller = init_controller(_automation_relay_callback)

RELAY_LABELS = {
    1: "Leafy Green",              # Pin 19
    2: "pH Down",                  # Pin 18
    3: "pH Up",                    # Pin 17
    4: "Misting Pump",             # Pin 23
    5: "Exhaust Fan (Out)",        # Pin 14
    6: "Grow Lights (Aeroponics)", # Pin 15
    7: "Air Pump",                 # Pin 12
    8: "Grow Lights (DWC)",        # Pin 16
    9: "Exhaust Fan (In)",         # Pin 13
}


def _init_relay_states():
    """Load relay states from DB on startup (only if no automation controller)."""
    global RELAY_STATES
    # Skip if automation controller is running - it will set the correct states
    if _automation_controller:
        print("[API] Skipping DB relay state load - automation controller is active", flush=True)
        return
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

# ==================== GROWTH COMPARISON ====================
@app.route("/api/growth-comparison")
def get_growth_comparison():
    """Get growth data for comparison graph grouped by farming system.
    
    Query params:
    - metric: 'height|length|width|leaves|branches' (default: 'height')
    - days: number of days to look back (default: 14, 'all' for all data)
    
    Returns daily averages per farming system for the selected metric.
    """
    metric = request.args.get('metric', 'height').lower()
    days_param = request.args.get('days', '14')
    
    # Map metric to database column
    metric_map = {
        'height': 'height',
        'length': 'length', 
        'width': 'weight',  # width is stored as weight in DB
        'leaves': 'leaves',
        'branches': 'branches'
    }
    
    db_column = metric_map.get(metric, 'height')
    
    with Session() as session:
        # Build cutoff
        if days_param.lower() == 'all':
            cutoff = datetime(2000, 1, 1, tzinfo=timezone.utc)
        else:
            try:
                days = int(days_param)
            except:
                days = 14
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        
        # Get daily averages per farming system
        # SQLite compatible date extraction
        query = text(f"""
            SELECT 
                DATE(timestamp) as day,
                farming_system,
                AVG({db_column}) as avg_value,
                COUNT(*) as count
            FROM plant_readings
            WHERE timestamp >= :cutoff
              AND {db_column} IS NOT NULL
            GROUP BY DATE(timestamp), farming_system
            ORDER BY day ASC
        """)
        
        rows = session.execute(query, {"cutoff": cutoff}).fetchall()
    
    # Organize by farming system
    aeroponics_data = []
    dwc_data = []
    traditional_data = []
    dates = set()
    
    for row in rows:
        day = str(row[0])  # date as string
        system = row[1]
        value = float(row[2]) if row[2] else 0
        dates.add(day)
        
        if system == 'aeroponics':
            aeroponics_data.append({'date': day, 'value': value})
        elif system == 'dwc':
            dwc_data.append({'date': day, 'value': value})
        elif system == 'traditional':
            traditional_data.append({'date': day, 'value': value})
    
    # Sort dates and create aligned arrays
    sorted_dates = sorted(list(dates))
    
    def get_values_aligned(data_list, dates_list):
        """Align data to sorted dates, fill gaps with None"""
        date_map = {d['date']: d['value'] for d in data_list}
        return [date_map.get(d) for d in dates_list]
    
    return jsonify({
        'success': True,
        'metric': metric,
        'days': days_param,
        'dates': sorted_dates,
        'aeroponic': get_values_aligned(aeroponics_data, sorted_dates),
        'dwc': get_values_aligned(dwc_data, sorted_dates),
        'traditional': get_values_aligned(traditional_data, sorted_dates)
    })

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
        "override_mode": OVERRIDE_MODE_ENABLED,
        "relays": [
            {"id": i, "label": RELAY_LABELS.get(i, f"Relay {i}"), "state": RELAY_STATES[i]}
            for i in range(1, 10)  # 9 relays
        ]
    })


# ==================== OVERRIDE MODE (Manual Control) ====================
@app.route("/api/override-mode", methods=["GET"])
def get_override_mode():
    """Get current override mode status."""
    controller = get_controller()
    return jsonify({
        "success": True,
        "enabled": OVERRIDE_MODE_ENABLED,
        "automation_status": controller.get_status() if controller else None
    })


@app.route("/api/override-mode", methods=["POST"])
def set_override_mode():
    """Enable/disable override mode (disables automation for manual control)."""
    global OVERRIDE_MODE_ENABLED
    data = request.get_json() or {}
    enabled = data.get("enabled", False)
    
    OVERRIDE_MODE_ENABLED = bool(enabled)
    
    # Always zero all relays on mode change (clean slate)
    for i in range(1, 10):
        RELAY_STATES[i] = False
    print(f"[OVERRIDE MODE] All relays zeroed", flush=True)
    
    # Sync with automation controller
    controller = get_controller()
    if controller:
        controller.set_override(OVERRIDE_MODE_ENABLED)
    
    if not OVERRIDE_MODE_ENABLED:
        print("[OVERRIDE MODE] DISABLED - automation will resync within 10s", flush=True)
    else:
        print("[OVERRIDE MODE] ENABLED - manual control active", flush=True)
    
    return jsonify({
        "success": True,
        "enabled": OVERRIDE_MODE_ENABLED,
        "message": "Manual control enabled - automation suspended" if OVERRIDE_MODE_ENABLED else "Automation enabled"
    })


@app.route("/api/automation/status")
def automation_status():
    """Get detailed automation status including filtered values and thresholds."""
    controller = get_controller()
    if not controller:
        return jsonify({"success": False, "error": "Automation controller not initialized"})
    return jsonify({"success": True, **controller.get_status()})


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


def _save_relay_state(relay_id, state):
    """Save relay state to DB for persistence and history."""
    try:
        with Session() as session:
            # Save to sensor_readings for legacy compatibility
            session.add(SensorReading(
                timestamp=_utcnow(),
                sensor=f"relay_{relay_id}",
                value=1.0 if state else 0.0,
                unit="state",
                meta={"label": RELAY_LABELS.get(relay_id)}
            ))
            # Also save to actuator_events for proper history tracking
            session.add(ActuatorEvent(
                timestamp=_utcnow(),
                relay_id=relay_id,
                state=1 if state else 0,
                meta={"label": RELAY_LABELS.get(relay_id), "source": "api"}
            ))
            session.commit()
            print(f"[DB] Saved relay_{relay_id} = {state}", flush=True)
    except Exception as e:
        import traceback
        print(f"[DB] Error saving relay state: {e}", flush=True)
        traceback.print_exc()


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

@app.route("/api/predict", methods=["GET", "POST"])
def predict_growth():
    """Predict plant growth using trained ML models.
    
    Query params or JSON body:
    - day: Target day number (1-30, default: current day)
    - farming_system: 'Aquaponics', 'Hydroponics', or 'Soil-based'
    
    Returns predictions for: height, length, width, leaf_count, branch_count
    """
    import pickle
    import numpy as np
    
    MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
    
    # Check if models exist
    model_info_path = os.path.join(MODEL_DIR, 'model_info.json')
    if not os.path.exists(model_info_path):
        return jsonify({"error": "No trained models found. Run train_model.py first."}), 404
    
    # Get parameters
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
    else:
        data = {}
    
    day = int(request.args.get('day') or data.get('day') or 1)
    farming_system = request.args.get('farming_system') or data.get('farming_system') or 'Aquaponics'
    
    try:
        # Load model artifacts
        with open(os.path.join(MODEL_DIR, 'scaler.pkl'), 'rb') as f:
            scaler = pickle.load(f)
        with open(os.path.join(MODEL_DIR, 'label_encoder.pkl'), 'rb') as f:
            le = pickle.load(f)
        with open(os.path.join(MODEL_DIR, 'feature_cols.json'), 'r') as f:
            feature_cols = json.load(f)
        with open(model_info_path, 'r') as f:
            model_info = json.load(f)
        
        # Encode farming system
        try:
            system_encoded = le.transform([farming_system])[0]
        except ValueError:
            return jsonify({"error": f"Unknown farming_system: {farming_system}. Use: {list(le.classes_)}"}), 400
        
        # Get current sensor readings for features
        with Session() as session:
            latest = {}
            for sensor in ['temperature', 'humidity', 'ph', 'tds', 'do']:
                row = session.execute(
                    text(f"SELECT value FROM sensor_readings WHERE sensor = :s ORDER BY timestamp DESC LIMIT 1"),
                    {"s": sensor}
                ).first()
                latest[sensor] = float(row[0]) if row else 0
        
        # Build feature vector
        features = []
        for col in feature_cols:
            if col == 'day_num':
                features.append(day)
            elif col == 'farming_system_encoded':
                features.append(system_encoded)
            elif col in latest:
                features.append(latest[col])
            else:
                features.append(0)
        
        # Scale features
        X = scaler.transform([features])
        
        # Make predictions with each target's model
        predictions = {}
        for target in ['height', 'length', 'width', 'leaf_count', 'branch_count']:
            model_path = os.path.join(MODEL_DIR, f'{target}_model.pkl')
            if os.path.exists(model_path):
                with open(model_path, 'rb') as f:
                    model = pickle.load(f)
                pred = model.predict(X)[0]
                predictions[target] = round(max(0, pred), 2)
        
        return jsonify({
            "day": day,
            "farming_system": farming_system,
            "predictions": predictions,
            "model_info": {
                "trained_at": model_info.get("trained_at"),
                "training_days": model_info.get("training_days"),
                "testing_days": model_info.get("testing_days"),
                "best_models": model_info.get("best_models", {})
            },
            "current_conditions": latest
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/voltage", methods=["GET"])
def get_voltage():
    """Get latest raw voltage readings for calibration.
    
    Returns the most recent voltage values for pH, TDS, and DO sensors.
    Extracts voltage from metadata of ph and do_mg_l sensor readings.
    """
    import json as _json
    with Session() as session:
        result = {}
        
        # Get pH voltage from ph sensor's meta
        ph_row = session.execute(
            text("SELECT meta, timestamp FROM sensor_readings WHERE sensor = 'ph' ORDER BY timestamp DESC LIMIT 1")
        ).first()
        if ph_row and ph_row[0]:
            meta_raw = ph_row[0]
            meta = meta_raw if isinstance(meta_raw, dict) else _json.loads(meta_raw) if isinstance(meta_raw, str) else {}
            if "ph_voltage_v" in meta:
                result["ph"] = {
                    "voltage": meta["ph_voltage_v"],
                    "timestamp": _format_ts_for_display(ph_row[1])
                }
        
        # Get DO voltage from do_mg_l sensor's meta
        do_row = session.execute(
            text("SELECT meta, timestamp FROM sensor_readings WHERE sensor = 'do_mg_l' ORDER BY timestamp DESC LIMIT 1")
        ).first()
        if do_row and do_row[0]:
            meta_raw = do_row[0]
            meta = meta_raw if isinstance(meta_raw, dict) else _json.loads(meta_raw) if isinstance(meta_raw, str) else {}
            if "do_voltage_v" in meta:
                result["do"] = {
                    "voltage": meta["do_voltage_v"],
                    "timestamp": _format_ts_for_display(do_row[1])
                }
        
        # Get TDS voltage from tds_ppm sensor's meta
        tds_row = session.execute(
            text("SELECT meta, timestamp FROM sensor_readings WHERE sensor = 'tds_ppm' ORDER BY timestamp DESC LIMIT 1")
        ).first()
        if tds_row and tds_row[0]:
            meta_raw = tds_row[0]
            meta = meta_raw if isinstance(meta_raw, dict) else _json.loads(meta_raw) if isinstance(meta_raw, str) else {}
            if "tds_voltage_v" in meta:
                result["tds"] = {
                    "voltage": meta["tds_voltage_v"],
                    "timestamp": _format_ts_for_display(tds_row[1])
                }
        
        return jsonify(result)


@app.route("/api/serial-log")
def serial_log():
    """Return recent ESP32 serial output lines."""
    limit = request.args.get('limit', 100, type=int)
    with _serial_log_lock:
        lines = list(_serial_log)[-limit:]
    return jsonify({"lines": lines, "count": len(lines)})


@app.route("/api/serial-cmd", methods=["POST"])
def serial_cmd():
    """Send a command to ESP32 via serial and return response."""
    data = request.get_json(silent=True) or {}
    cmd = data.get("cmd", "").strip()
    if not cmd:
        return jsonify({"success": False, "error": "No command provided"}), 400
    _serial_log_append(f">>> {cmd}")
    result = _send_serial_command(cmd)
    for line in result.get("response", []):
        _serial_log_append(line)
    return jsonify(result)


if __name__ == "__main__":
    # Start serial reader thread
    _serial_reader = threading.Thread(target=_serial_reader_thread, daemon=True)
    _serial_reader.start()

    # Start automation controller background thread
    if _automation_controller:
        _automation_controller.start()
        print("[API] Automation controller started")
    
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)