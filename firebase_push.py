#!/usr/bin/env python3
"""
Push latest sensor readings to Firebase every 30 seconds.
Complements firebase_sync.py which handles history and relay commands.
"""

import os
import time
import logging
from datetime import datetime
from pathlib import Path

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print("ERROR: firebase-admin not installed")
    exit(1)

from db import get_session

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("firebase_push")

SERVICE_ACCOUNT_FILE = Path(__file__).parent / "firebase-service-account.json"
PUSH_INTERVAL = 30  # seconds

def init_firebase():
    """Initialize Firebase Admin SDK."""
    try:
        if not firebase_admin.get_app():
            cred = credentials.Certificate(str(SERVICE_ACCOUNT_FILE))
            firebase_admin.initialize_app(cred)
    except ValueError:
        pass  # App already initialized
    
    return firestore.client()

def get_latest_readings(session):
    """Get latest value for each sensor from database."""
    from sqlalchemy import text
    
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
    
    readings = {}
    for sensor, value, unit, timestamp in result:
        readings[sensor] = {
            "value": float(value),
            "unit": unit,
            "timestamp": str(timestamp)
        }
    
    return readings

def push_to_firebase(db, readings):
    """Push latest readings to Firebase 'sensors/latest' document."""
    try:
        if not readings:
            return False
        
        doc_ref = db.collection("sensors").document("latest")
        
        # Add server timestamp
        readings["_updated"] = firestore.SERVER_TIMESTAMP
        readings["_source"] = "rpi-collector"
        
        # Merge so we don't overwrite other fields (like calibration)
        doc_ref.set(readings, merge=True, timeout=10)
        logger.info(f"✅ Pushed {len(readings)} sensor readings to Firebase")
        return True
    
    except Exception as e:
        logger.error(f"❌ Firebase push error: {e}")
        return False

def main():
    logger.info("Starting Firebase sensor push daemon...")
    
    try:
        db = init_firebase()
        session = get_session()
        
        while True:
            try:
                readings = get_latest_readings(session)
                if readings:
                    push_to_firebase(db, readings)
                else:
                    logger.warning("No readings found in database")
                
                time.sleep(PUSH_INTERVAL)
            
            except Exception as e:
                logger.error(f"Error in push loop: {e}")
                time.sleep(PUSH_INTERVAL)
    
    finally:
        session.close()

if __name__ == "__main__":
    main()
