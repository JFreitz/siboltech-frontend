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
    from google.api_core.retry import Retry
except ImportError:
    print("ERROR: firebase-admin not installed. Run: pip install firebase-admin")
    exit(1)

# Short timeout + retry for Firestore operations to avoid 120s+ hangs on quota errors
FIRESTORE_TIMEOUT = 3   # seconds (RPC deadline)
FIRESTORE_RETRY = Retry(deadline=3, initial=0.5, maximum=2)  # retry for max 3s total

from db import SensorReading, ActuatorEvent, init_db, get_session

# Configuration
SERVICE_ACCOUNT_FILE = os.getenv(
    "FIREBASE_SERVICE_ACCOUNT", 
    str(Path(__file__).parent / "firebase-service-account.json")
)
SYNC_INTERVAL = int(os.getenv("FIREBASE_SYNC_INTERVAL", "5"))  # seconds (balance responsiveness vs quota)
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
        entry = {
            "value": r.value,
            "unit": r.unit,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        }
        # Include raw voltage from meta for calibration (pH, DO, TDS)
        if r.meta:
            meta = r.meta if isinstance(r.meta, dict) else json.loads(r.meta) if isinstance(r.meta, str) else {}
            voltage_keys = {"ph": "ph_voltage_v", "do_mg_l": "do_voltage_v", "tds_ppm": "tds_voltage_v"}
            vk = voltage_keys.get(r.sensor)
            if vk and vk in meta:
                entry["raw_voltage"] = meta[vk]
        result[r.sensor] = entry
    return result


def sync_latest_to_firebase(db: firestore.Client, session):
    """Sync the latest sensor readings to Firebase."""
    session.expire_all()  # Force fresh read from DB (avoid stale cache)
    readings = get_latest_readings(session)
    
    if not readings:
        return False
    
    # Update the "latest" document with all current readings
    doc_ref = db.collection("sensors").document("latest")
    
    # Add server timestamp
    readings["_updated"] = firestore.SERVER_TIMESTAMP
    readings["_source"] = "rpi-collector"
    
    doc_ref.set(readings, merge=True, timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
    return True


def process_relay_commands(db: firestore.Client):
    """Check for pending relay commands and execute them via API.
    Returns True if any commands were processed."""
    import requests
    from google.cloud.firestore_v1.base_query import FieldFilter
    
    commands_ref = db.collection("relay_commands")
    
    # Get pending commands (without ordering to avoid index requirement)
    pending = commands_ref.where(filter=FieldFilter("status", "==", "pending")).limit(10).stream(timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
    
    had_commands = False
    for doc in pending:
        had_commands = True
        cmd_data = doc.to_dict()
        relay = cmd_data.get("relay", "").upper()  # e.g., "R1"
        action = cmd_data.get("action", "").lower()  # "on" or "off"
        
        # Extract relay number (R1 -> 1)
        try:
            relay_num = int(relay.replace("R", ""))
        except:
            doc.reference.update({"status": "error", "response": f"Invalid relay: {relay}"}, timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
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
        }, timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
        print(f"    → {response}")
    
    return had_commands


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
        }, merge=True, timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)


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
        }, merge=True, timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)


def check_override_mode(db: firestore.Client, last_override_state: bool) -> bool:
    """Check if override mode was changed from dashboard via Firebase.
    Returns the current override state."""
    import requests
    
    try:
        doc_ref = db.collection("settings").document("override_mode")
        doc = doc_ref.get(timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
        
        if doc.exists:
            data = doc.to_dict()
            enabled = data.get("enabled", False)
            source = data.get("source", "")
            
            # Only act on dashboard-originated changes
            if source == "dashboard" and enabled != last_override_state:
                print(f"  🔒 Override mode changed from dashboard: {'ON' if enabled else 'OFF'}")
                try:
                    resp = requests.post(
                        "http://localhost:5000/api/override-mode",
                        json={"enabled": enabled},
                        timeout=2
                    )
                    if resp.ok:
                        print(f"    → API synced: override={'ON' if enabled else 'OFF'}")
                        # Mark as processed so we don't re-apply
                        doc_ref.update({"source": "rpi-synced"}, timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
                    else:
                        print(f"    → API error: {resp.status_code}")
                except Exception as e:
                    print(f"    → API error: {e}")
                return enabled
        
        return last_override_state
    except Exception as e:
        print(f"  ⚠️ Override check error: {e}")
        raise  # re-raise so main loop backoff can handle it


def check_calibration_mode(db: firestore.Client, last_cal_mode_state: bool) -> bool:
    """Check if calibration mode was changed from dashboard via Firebase.
    Returns the current calibration mode state."""
    import requests

    try:
        doc_ref = db.collection("settings").document("calibration_mode")
        doc = doc_ref.get(timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)

        if doc.exists:
            data = doc.to_dict()
            enabled = data.get("enabled", False)
            source = data.get("source", "")

            if source == "dashboard" and enabled != last_cal_mode_state:
                print(f"  🔧 Calibration mode changed from dashboard: {'ON' if enabled else 'OFF'}")
                try:
                    resp = requests.post(
                        "http://localhost:5000/api/calibration-mode",
                        json={"enabled": enabled},
                        timeout=2
                    )
                    if resp.ok:
                        print(f"    → API synced: calibration_mode={'ON' if enabled else 'OFF'}")
                        doc_ref.update({"source": "rpi-synced"}, timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
                    else:
                        print(f"    → API error: {resp.status_code}")
                except Exception as e:
                    print(f"    → API error: {e}")
                return enabled

        return last_cal_mode_state
    except Exception as e:
        print(f"  ⚠️ Cal mode check error: {e}")
        raise  # re-raise so main loop backoff can handle it


def check_calibration_updates(db: firestore.Client, last_cal_check: datetime) -> datetime:
    """Check if calibration was updated from dashboard."""
    doc_ref = db.collection("settings").document("calibration")
    doc = doc_ref.get(timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
    
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
                    doc_ref.update({"_source": "rpi"}, timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
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
        batch.commit(timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
        print(f"  Synced {batch_count} history entries to Firebase")
    
    return latest_ts


def sync_actuator_events_to_firebase(db: firestore.Client, session, last_actuator_sync_ts: datetime) -> datetime:
    """Sync new actuator events since last sync to Firebase actuators/history/events collection."""
    if last_actuator_sync_ts.tzinfo is None:
        last_actuator_sync_ts = last_actuator_sync_ts.replace(tzinfo=timezone.utc)

    events = (
        session.query(ActuatorEvent)
        .filter(ActuatorEvent.timestamp > last_actuator_sync_ts)
        .order_by(ActuatorEvent.timestamp.asc())
        .limit(BATCH_SIZE * 5)
        .all()
    )

    if not events:
        return last_actuator_sync_ts

    RELAY_LABELS = {
        1: 'Leafy Green', 2: 'pH Down', 3: 'pH Up', 4: 'Misting',
        5: 'Exhaust OUT', 6: 'Lights Aero', 7: 'Air Pump',
        8: 'Lights DWC', 9: 'Exhaust IN'
    }

    batch = db.batch()
    latest_ts = last_actuator_sync_ts
    batch_count = 0

    for evt in events:
        if batch_count >= BATCH_SIZE * 2:
            break

        evt_ts = evt.timestamp
        if evt_ts.tzinfo is None:
            evt_ts = evt_ts.replace(tzinfo=timezone.utc)

        doc_id = f"r{evt.relay_id}_{evt_ts.isoformat().replace(':', '-').replace('+', '_')}"
        doc_ref = db.collection("actuators").document("history").collection("events").document(doc_id)

        doc_data = {
            "timestamp": evt_ts.isoformat(),
            "relay_id": evt.relay_id,
            "state": evt.state,
            "label": RELAY_LABELS.get(evt.relay_id, f"Relay {evt.relay_id}"),
            "meta": evt.meta if evt.meta else {},
        }
        batch.set(doc_ref, doc_data)
        batch_count += 1

        if evt_ts > latest_ts:
            latest_ts = evt_ts

    if batch_count > 0:
        batch.commit(timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
        print(f"  Synced {batch_count} actuator events to Firebase")

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
    last_actuator_sync_ts = load_last_sync_ts()  # reuse same ts file logic
    last_cal_check = datetime.now(timezone.utc) - timedelta(hours=1)
    last_override_state = False  # Track override mode from dashboard
    last_cal_mode_state = False  # Track calibration mode from dashboard
    print(f"Last sync: {last_sync_ts.isoformat()}")
    print(f"Sync interval: {SYNC_INTERVAL}s")
    print("-" * 50)
    
    # Initial calibration sync
    sync_calibration_to_firebase(db)
    print("✅ Calibration synced to Firebase")
    
    sync_count = 0
    # Backoff timestamps: skip slow ops after they fail (quota errors)
    _relay_backoff_until = 0
    _override_backoff_until = 0
    _calmode_backoff_until = 0
    RELAY_BACKOFF_SECS = 10   # short backoff for relays (user-facing, needs responsiveness)
    OTHER_BACKOFF_SECS = 300  # 5 min backoff for override/cal mode (rarely used)
    
    while True:
        try:
            sync_count += 1
            now_ts = time.time()
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Sync #{sync_count}...")
            
            # === PRIORITY 1: Relay commands ONLY (minimal quota usage) ===
            if now_ts >= _relay_backoff_until:
                try:
                    had_commands = process_relay_commands(db)
                    # Only sync relay status to Firebase when a command was executed
                    if had_commands:
                        sync_relay_status_to_firebase(db)
                except Exception as e:
                    print(f"  ⚠️ Relay error: {e}")
                    if "429" in str(e) or "Quota" in str(e) or "Timeout" in str(e):
                        _relay_backoff_until = now_ts + RELAY_BACKOFF_SECS
                        print(f"    → backing off relay ops for {RELAY_BACKOFF_SECS}s")
            
            # === PRIORITY 2: Sync latest readings every 2nd cycle (~10s) ===
            if sync_count % 2 == 0:
                try:
                    if sync_latest_to_firebase(db, session):
                        print("  ✅ Latest readings synced")
                except Exception as e:
                    print(f"  ⚠️ Latest sync error: {e}")
            
            # === LOW PRIORITY: Override mode every 6th cycle (~30s) ===
            if sync_count % 6 == 0 and now_ts >= _override_backoff_until:
                try:
                    last_override_state = check_override_mode(db, last_override_state)
                except Exception as e:
                    if "429" in str(e) or "Quota" in str(e) or "Timeout" in str(e):
                        _override_backoff_until = now_ts + OTHER_BACKOFF_SECS
                        print(f"    → backing off override ops for {OTHER_BACKOFF_SECS}s")
            
            # === LOW PRIORITY: Cal mode every 10th cycle (~50s) ===
            if sync_count % 10 == 0 and now_ts >= _calmode_backoff_until:
                try:
                    last_cal_mode_state = check_calibration_mode(db, last_cal_mode_state)
                except Exception as e:
                    if "429" in str(e) or "Quota" in str(e) or "Timeout" in str(e):
                        _calmode_backoff_until = now_ts + OTHER_BACKOFF_SECS
                        print(f"    → backing off cal mode ops for {OTHER_BACKOFF_SECS}s")
            
            # Sync history (for charts) - every 5 syncs
            if sync_count % 5 == 0:
                new_ts = sync_history_to_firebase(db, session, last_sync_ts)
                if new_ts > last_sync_ts:
                    last_sync_ts = new_ts
                    save_last_sync_ts(last_sync_ts)
                # Also sync actuator events
                new_act_ts = sync_actuator_events_to_firebase(db, session, last_actuator_sync_ts)
                if new_act_ts > last_actuator_sync_ts:
                    last_actuator_sync_ts = new_act_ts
            
            # Check for calibration updates (every 15 syncs = ~30s)
            if sync_count % 15 == 0:
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
