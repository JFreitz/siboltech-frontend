#!/usr/bin/env python3
"""
Firebase Firestore sync for SIBOLTECH sensor readings.
Pushes sensor readings from local DB to Firebase in real-time.
Listens for relay commands from Firebase and executes them.
Syncs calibration settings bidirectionally.

Usage:
  python firebase_sync.py

Requires:
  - firebase-admin package: pip install firebase-admin
  - Service account JSON file: firebase-service-account.json
"""

import os
import json
import time
import serial
import threading
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
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyUSB0")
BAUD_RATE = 115200
CALIBRATION_FILE = Path(__file__).parent / "calibration.json"

# Global serial connection (shared with relay control)
serial_lock = threading.Lock()
serial_conn = None

def get_serial():
    """Get or create serial connection."""
    global serial_conn
    if serial_conn is None or not serial_conn.is_open:
        try:
            serial_conn = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
            time.sleep(0.5)
            serial_conn.reset_input_buffer()
        except Exception as e:
            print(f"  ⚠️ Serial not available: {e}")
            return None
    return serial_conn

def send_relay_command(cmd: str) -> str:
    """Send command to ESP32 and return response."""
    with serial_lock:
        ser = get_serial()
        if not ser:
            return "ERROR: Serial not available"
        
        try:
            ser.write((cmd + "\n").encode())
            ser.flush()
            time.sleep(0.05)
            
            response_lines = []
            start = time.time()
            while (time.time() - start) < 0.5:
                if ser.in_waiting:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        response_lines.append(line)
                        start = time.time()
                else:
                    time.sleep(0.01)
            
            return "\n".join(response_lines) if response_lines else "OK"
        except Exception as e:
            return f"ERROR: {e}"

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


def process_relay_commands(db: firestore.Client):
    """Check for pending relay commands and execute them via API."""
    import requests
    
    commands_ref = db.collection("relay_commands")
    
    # Get pending commands (not yet executed)
    pending = commands_ref.where("status", "==", "pending").order_by("created_at").limit(5).stream()
    
    for doc in pending:
        cmd_data = doc.to_dict()
        relay = cmd_data.get("relay", "").upper()  # e.g., "R1"
        action = cmd_data.get("action", "").lower()  # "on" or "off"
        
        # Extract relay number (R1 -> 1)
        try:
            relay_num = int(relay.replace("R", ""))
        except:
            doc.reference.update({"status": "error", "response": f"Invalid relay: {relay}"})
            continue
        
        print(f"  🔌 Relay command: R{relay_num} {action.upper()}")
        
        # Use API to update relay state (ESP32 polls this)
        try:
            api_url = f"http://localhost:5000/api/relay/{relay_num}/{action}"
            resp = requests.post(api_url, timeout=2)
            response = resp.json() if resp.ok else f"API error: {resp.status_code}"
        except Exception as e:
            response = f"API error: {e}"
        
        # Update command status
        doc.reference.update({
            "status": "executed",
            "response": str(response),
            "executed_at": firestore.SERVER_TIMESTAMP
        })
        print(f"    → {response}")


def get_relay_status() -> dict:
    """Get current relay status from API."""
    import requests
    try:
        resp = requests.get("http://localhost:5000/api/relay/pending", timeout=2)
        if resp.ok:
            data = resp.json()
            states_str = data.get("states", "")
            status = {}
            for i, c in enumerate(states_str):
                status[f"R{i+1}"] = "ON" if c == "1" else "OFF"
            return status
    except Exception as e:
        print(f"  ⚠️ Error getting relay status: {e}")
    return {}


def sync_relay_status_to_firebase(db: firestore.Client):
    """Sync current relay status to Firebase."""
    status = get_relay_status()
    if status:
        doc_ref = db.collection("actuators").document("relays")
        doc_ref.set({
            "status": status,
            "_updated": firestore.SERVER_TIMESTAMP
        }, merge=True)


def load_calibration() -> dict:
    """Load calibration from local file."""
    if CALIBRATION_FILE.exists():
        try:
            return json.loads(CALIBRATION_FILE.read_text())
        except:
            pass
    return {}


def save_calibration(cal: dict):
    """Save calibration to local file."""
    CALIBRATION_FILE.write_text(json.dumps(cal, indent=2))


def sync_calibration_to_firebase(db: firestore.Client):
    """Sync local calibration to Firebase."""
    cal = load_calibration()
    if cal:
        doc_ref = db.collection("settings").document("calibration")
        doc_ref.set({
            "sensors": cal,
            "_updated": firestore.SERVER_TIMESTAMP,
            "_source": "rpi"
        }, merge=True)


def check_calibration_updates(db: firestore.Client, last_cal_check: datetime) -> datetime:
    """Check if calibration was updated from dashboard."""
    doc_ref = db.collection("settings").document("calibration")
    doc = doc_ref.get()
    
    if doc.exists:
        data = doc.to_dict()
        updated = data.get("_updated")
        source = data.get("_source", "")
        
        # If updated from dashboard (not from RPi), apply it
        if source == "dashboard" and updated:
            if hasattr(updated, 'timestamp'):
                update_time = datetime.fromtimestamp(updated.timestamp(), tz=timezone.utc)
            else:
                update_time = updated
            
            if update_time > last_cal_check:
                print("  📐 Calibration updated from dashboard, applying...")
                cal = data.get("sensors", {})
                if cal:
                    save_calibration(cal)
                    # Reset source to prevent re-applying
                    doc_ref.update({"_source": "rpi"})
                return update_time
    
    return last_cal_check


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
        # Make timestamp timezone-aware if needed
        r_ts = r.timestamp
        if r_ts.tzinfo is None:
            r_ts = r_ts.replace(tzinfo=timezone.utc)
        
        ts_key = r_ts.replace(microsecond=0).isoformat()
        if ts_key not in grouped:
            grouped[ts_key] = {"timestamp": r_ts, "readings": {}}
        grouped[ts_key]["readings"][r.sensor] = {
            "value": r.value,
            "unit": r.unit,
        }
        if r_ts > latest_ts:
            latest_ts = r_ts
    
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
    
    # Check serial
    if get_serial():
        print("✅ Serial connected to ESP32")
    else:
        print("⚠️ Serial not available (relay control disabled)")
    
    last_sync_ts = load_last_sync_ts()
    last_cal_check = datetime.now(timezone.utc) - timedelta(hours=1)
    print(f"Last sync: {last_sync_ts.isoformat()}")
    print(f"Sync interval: {SYNC_INTERVAL}s")
    print("-" * 50)
    
    # Initial calibration sync
    sync_calibration_to_firebase(db)
    print("✅ Calibration synced to Firebase")
    
    sync_count = 0
    relay_check_interval = 2  # Check relay commands every 2 syncs
    
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
            
            # Check for relay commands (every 2 syncs = ~10s)
            if sync_count % relay_check_interval == 0:
                process_relay_commands(db)
                sync_relay_status_to_firebase(db)
            
            # Check for calibration updates (every 6 syncs = ~30s)
            if sync_count % 6 == 0:
                last_cal_check = check_calibration_updates(db, last_cal_check)
            
            time.sleep(SYNC_INTERVAL)
            
        except KeyboardInterrupt:
            print("\n👋 Stopping Firebase sync...")
            break
        except Exception as e:
            print(f"  ❌ Error: {e}")
            time.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    main()
