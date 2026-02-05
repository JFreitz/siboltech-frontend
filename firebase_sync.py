#!/usr/bin/env python3
"""
Firebase Firestore sync for SIBOLTECH sensor readings.
Pushes sensor readings from local DB to Firebase in real-time.

Usage:
  python firebase_sync.py

Requires:
  - firebase-admin package: pip install firebase-admin
  - Service account JSON file: firebase-service-account.json
"""

import os
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print("ERROR: firebase-admin not installed. Run: pip install firebase-admin")
    exit(1)

from db import SensorReading, init_db, get_session

# Configuration
SERVICE_ACCOUNT_FILE = os.getenv(
    "FIREBASE_SERVICE_ACCOUNT", 
    str(Path(__file__).parent / "firebase-service-account.json")
)
SYNC_INTERVAL = int(os.getenv("FIREBASE_SYNC_INTERVAL", "5"))  # seconds
BATCH_SIZE = 10  # Max readings per sync

# Initialize Firebase
def init_firebase():
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"ERROR: Service account file not found: {SERVICE_ACCOUNT_FILE}")
        print("Download it from Firebase Console > Project Settings > Service Accounts")
        exit(1)
    
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def get_latest_readings(session) -> dict:
    """Get the latest reading for each sensor."""
    from sqlalchemy import func
    
    # Subquery to get max timestamp per sensor
    subq = (
        session.query(
            SensorReading.sensor,
            func.max(SensorReading.timestamp).label("max_ts")
        )
        .group_by(SensorReading.sensor)
        .subquery()
    )
    
    # Join to get full rows
    latest = (
        session.query(SensorReading)
        .join(
            subq,
            (SensorReading.sensor == subq.c.sensor) &
            (SensorReading.timestamp == subq.c.max_ts)
        )
        .all()
    )
    
    result = {}
    for r in latest:
        result[r.sensor] = {
            "value": r.value,
            "unit": r.unit,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        }
    return result


def sync_latest_to_firebase(db: firestore.Client, session):
    """Sync the latest sensor readings to Firebase."""
    readings = get_latest_readings(session)
    
    if not readings:
        return False
    
    # Update the "latest" document with all current readings
    doc_ref = db.collection("sensors").document("latest")
    
    # Add server timestamp
    readings["_updated"] = firestore.SERVER_TIMESTAMP
    readings["_source"] = "rpi-collector"
    
    doc_ref.set(readings, merge=True)
    return True


def sync_history_to_firebase(db: firestore.Client, session, last_sync_ts: datetime) -> datetime:
    """Sync new readings since last sync to history collection."""
    # Ensure last_sync_ts is timezone-aware
    if last_sync_ts.tzinfo is None:
        last_sync_ts = last_sync_ts.replace(tzinfo=timezone.utc)
    
    new_readings = (
        session.query(SensorReading)
        .filter(SensorReading.timestamp > last_sync_ts)
        .order_by(SensorReading.timestamp.asc())
        .limit(BATCH_SIZE * 5)
        .all()
    )
    
    if not new_readings:
        return last_sync_ts
    
    # Group by timestamp (batch readings from same time)
    batch = db.batch()
    latest_ts = last_sync_ts
    batch_count = 0
    
    # Group readings by rounded timestamp (to 1 second)
    grouped = {}
    for r in new_readings:
        ts_key = r.timestamp.replace(microsecond=0).isoformat()
        if ts_key not in grouped:
            grouped[ts_key] = {"timestamp": r.timestamp, "readings": {}}
        grouped[ts_key]["readings"][r.sensor] = {
            "value": r.value,
            "unit": r.unit,
        }
        if r.timestamp > latest_ts:
            latest_ts = r.timestamp
    
    # Write grouped readings to history
    for ts_key, data in grouped.items():
        if batch_count >= BATCH_SIZE:
            break
        
        doc_id = ts_key.replace(":", "-").replace("+", "_")
        doc_ref = db.collection("sensors").document("history").collection("readings").document(doc_id)
        
        doc_data = {
            "timestamp": data["timestamp"].isoformat(),
            "readings": data["readings"],
        }
        batch.set(doc_ref, doc_data)
        batch_count += 1
    
    if batch_count > 0:
        batch.commit()
        print(f"  Synced {batch_count} history entries to Firebase")
    
    return latest_ts


def load_last_sync_ts() -> datetime:
    """Load last sync timestamp from file."""
    ts_file = Path(__file__).parent / ".firebase_last_sync_ts"
    if ts_file.exists():
        try:
            ts_str = ts_file.read_text().strip()
            return datetime.fromisoformat(ts_str)
        except:
            pass
    # Default to 1 hour ago
    return datetime.now(timezone.utc) - timedelta(hours=1)


def save_last_sync_ts(ts: datetime):
    """Save last sync timestamp to file."""
    ts_file = Path(__file__).parent / ".firebase_last_sync_ts"
    ts_file.write_text(ts.isoformat())


def main():
    print("=" * 50)
    print("  SIBOLTECH Firebase Sync")
    print("=" * 50)
    
    # Initialize
    print(f"Loading service account from: {SERVICE_ACCOUNT_FILE}")
    db = init_firebase()
    print("✅ Connected to Firebase")
    
    init_db()
    session = get_session()
    print("✅ Connected to local database")
    
    last_sync_ts = load_last_sync_ts()
    print(f"Last sync: {last_sync_ts.isoformat()}")
    print(f"Sync interval: {SYNC_INTERVAL}s")
    print("-" * 50)
    
    sync_count = 0
    while True:
        try:
            sync_count += 1
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Sync #{sync_count}...")
            
            # Sync latest readings (for real-time dashboard)
            if sync_latest_to_firebase(db, session):
                print("  ✅ Latest readings synced")
            
            # Sync history (for charts)
            new_ts = sync_history_to_firebase(db, session, last_sync_ts)
            if new_ts > last_sync_ts:
                last_sync_ts = new_ts
                save_last_sync_ts(last_sync_ts)
            
            time.sleep(SYNC_INTERVAL)
            
        except KeyboardInterrupt:
            print("\n👋 Stopping Firebase sync...")
            break
        except Exception as e:
            print(f"  ❌ Error: {e}")
            time.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    main()
