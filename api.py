#!/usr/bin/env python3
"""Simple Flask API to serve sensor data from a DB.

Intended deployment: Railway (or any container host) with Postgres.
Local dev: SQLite (Despro/sensors.db).

This module avoids Postgres-specific SQL so it can run on both.
"""

import os
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from db import Base, SensorReading


app = Flask(__name__)
CORS(app)

_DEFAULT_SQLITE_PATH = os.path.join(os.path.dirname(__file__), "sensors.db")
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_SQLITE_PATH}")

engine = create_engine(DB_URL, echo=False, future=True)
Session = sessionmaker(bind=engine)

# Ensure schema exists (safe on Postgres too).
Base.metadata.create_all(bind=engine)


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

    allowed = os.getenv("ALLOWED_SENSORS", "temperature_c,humidity")
    allowed_sensors = {s.strip() for s in allowed.split(",") if s.strip()}
    units = {"temperature_c": "C", "humidity": "%"}

    to_insert = []
    for sensor, value in readings.items():
        sensor_name = str(sensor)
        if allowed_sensors and sensor_name not in allowed_sensors:
            continue
        try:
            v = float(value)
        except Exception:
            continue
        to_insert.append(
            SensorReading(
                timestamp=ts,
                sensor=sensor_name,
                value=v,
                unit=units.get(sensor_name),
                meta={"source": "http_ingest", "device": device},
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
                WHERE sensor IN ('temperature_c', 'humidity')
                  AND timestamp >= :cutoff
                ORDER BY timestamp DESC
                """
            ),
            {"cutoff": cutoff},
        ).fetchall()
    
    data = [{"sensor": r[0], "value": r[1], "unit": r[2], "timestamp": str(r[3])} for r in result]
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
                WHERE sensor IN ('temperature_c', 'humidity')
                ORDER BY sensor ASC, timestamp DESC
                """
            )
        ).fetchall()

    data = {}
    for r in rows:
        sensor = r[0]
        if sensor in data:
            continue
        data[sensor] = {"value": r[1], "unit": r[2], "timestamp": str(r[3])}
    return jsonify(data)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)