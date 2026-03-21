#!/usr/bin/env python3
"""
Serial ingestion from ESP32 to database.
Reads JSON sensor data from ESP32 via USB serial and saves to database.

Usage:
    python ingest_serial.py --port /dev/ttyUSB0
"""

import serial
import json
import time
import argparse
import logging
import os
from datetime import datetime, timezone
from sqlalchemy import text
from db import get_session, SensorReading

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ingest_serial")

# Firebase sync (optional)
firebase_db = None
try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    
    cred_file = os.path.expanduser("~/Despro/firebase-service-account.json")
    if os.path.exists(cred_file):
        cred = credentials.Certificate(cred_file)
        firebase_admin.initialize_app(cred)
        firebase_db = firestore.client()
        logger.info("Firebase initialized for real-time sync")
    else:
        logger.warning(f"Firebase credentials not found: {cred_file}")
except Exception as e:
    logger.warning(f"Firebase initialization failed: {e}")

def ingest_json(session, json_data):
    """Parse ESP32 JSON and save to database."""
    try:
        data = json.loads(json_data)
        readings = data.get("readings", {})
        
        # Parse sensor readings
        if "temp" in readings:
            r = SensorReading(
                timestamp=datetime.now(timezone.utc),
                sensor="temperature_c",
                value=float(readings["temp"]),
                unit="C",
                meta={"source": "esp32"}
            )
            session.add(r)
        
        if "humidity" in readings:
            r = SensorReading(
                timestamp=datetime.now(timezone.utc),
                sensor="humidity",
                value=float(readings["humidity"]),
                unit="%",
                meta={"source": "esp32"}
            )
            session.add(r)
        
        if "tds" in readings:
            r = SensorReading(
                timestamp=datetime.now(timezone.utc),
                sensor="tds_ppm",
                value=float(readings["tds"]),
                unit="ppm",
                meta={"source": "esp32", "voltage": readings.get("tds_v")}
            )
            session.add(r)
        
        if "ph_v" in readings or "ph" in readings:
            # Convert voltage to pH if available
            ph_val = readings.get("ph", readings.get("ph_v"))
            r = SensorReading(
                timestamp=datetime.now(timezone.utc),
                sensor="ph",
                value=float(ph_val),
                unit="pH",
                meta={"source": "esp32", "voltage": readings.get("ph_v")}
            )
            session.add(r)
        
        if "do_v" in readings or "do" in readings:
            do_val = readings.get("do", readings.get("do_v"))
            r = SensorReading(
                timestamp=datetime.now(timezone.utc),
                sensor="do_mg_per_l",
                value=float(do_val),
                unit="mg/L",
                meta={"source": "esp32", "voltage": readings.get("do_v")}
            )
            session.add(r)
        
        session.commit()
        logger.info(f"Ingested readings from ESP32")
        
        # Sync to Firebase if available
        if firebase_db:
            try:
                latest_data = {}
                for sensor in ["temperature_c", "humidity", "tds_ppm", "ph", "do_mg_per_l"]:
                    result = session.execute(
                        text("SELECT value, unit, timestamp FROM sensor_readings WHERE sensor = :sensor ORDER BY timestamp DESC LIMIT 1"),
                        {"sensor": sensor}
                    ).fetchone()
                    if result:
                        ts = result[2]
                        # Handle both datetime and string timestamps
                        ts_str = ts.isoformat() if hasattr(ts, 'isoformat') else str(ts)
                        latest_data[sensor] = {"value": result[0], "unit": result[1], "timestamp": ts_str}
                
                if latest_data:
                    latest_data["_updated"] = datetime.now(timezone.utc).isoformat()
                    latest_data["_source"] = "rpi-collector"
                    firebase_db.collection("sensors").document("latest").set(latest_data, merge=True)
                    logger.debug(f"Synced {len(latest_data)} sensors to Firebase")
            except Exception as e:
                logger.warning(f"Firebase sync failed: {e}")
        
    except json.JSONDecodeError as e:
        logger.debug(f"Invalid JSON: {e}")
    except Exception as e:
        logger.error(f"Error ingesting data: {e}")
        session.rollback()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default="/dev/ttyUSB0", help="Serial port")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    args = parser.parse_args()
    
    logger.info(f"Opening serial port {args.port} at {args.baud} baud")
    
    try:
        ser = serial.Serial(args.port, args.baud, timeout=2)
        session = get_session()
        
        logger.info("Listening for ESP32 data...")
        
        while True:
            try:
                if ser.in_waiting:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line and line.startswith('{'):
                        logger.debug(f"Received: {line[:80]}")
                        ingest_json(session, line)
                time.sleep(0.01)
            except Exception as e:
                logger.error(f"Error reading serial: {e}")
                time.sleep(1)
    
    except serial.SerialException as e:
        logger.error(f"Serial port error: {e}")
    finally:
        ser.close()
        session.close()

if __name__ == "__main__":
    main()
