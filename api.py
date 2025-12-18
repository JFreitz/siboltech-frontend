#!/usr/bin/env python3
"""
Simple Flask API to serve sensor data from cloud DB.
Deploy on Railway, Vercel calls this for dashboard.
"""

import os
from flask import Flask, jsonify
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

app = Flask(__name__)

DB_URL = os.getenv("DATABASE_URL", "sqlite:///sensors.db")  # Cloud URL in production
engine = create_engine(DB_URL, echo=False)
Session = sessionmaker(bind=engine)

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
    with Session() as session:
        result = session.execute(text("""
            SELECT sensor, value, unit, timestamp 
            FROM sensor_readings
            WHERE timestamp >= now() - interval '1 hour'
            ORDER BY timestamp DESC
        """)).fetchall()
    
    data = [{"sensor": r[0], "value": r[1], "unit": r[2], "timestamp": str(r[3])} for r in result]
    return jsonify(data)

@app.route("/api/latest")
def get_latest():
    """Get latest value per sensor."""
    with Session() as session:
        result = session.execute(text("""
            SELECT DISTINCT ON (sensor) sensor, value, unit, timestamp
            FROM sensor_readings
            ORDER BY sensor, timestamp DESC
        """)).fetchall()
    
    data = {r[0]: {"value": r[1], "unit": r[2], "timestamp": str(r[3])} for r in result}
    return jsonify(data)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)