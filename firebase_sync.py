#!/usr/bin/env python3
# Force native DNS resolver BEFORE any grpc import
import os as _os
_os.environ["GRPC_DNS_RESOLVER"] = "native"

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

# Firestore timeout — 15s allows gRPC cold-start DNS to resolve
FIRESTORE_TIMEOUT = 15    # seconds (RPC deadline)
FIRESTORE_RETRY = Retry(deadline=15, initial=1, maximum=4)  # retry with longer deadline

from db import SensorReading, ActuatorEvent, init_db, get_session

# Configuration
SERVICE_ACCOUNT_FILE = os.getenv(
    "FIREBASE_SERVICE_ACCOUNT", 
    str(Path(__file__).parent / "firebase-service-account.json")
)
SYNC_INTERVAL = int(os.getenv("FIREBASE_SYNC_INTERVAL", "5"))  # seconds
BATCH_SIZE = 10  # Keep small — only new data flows in, no backlog

# Auto-detect serial port (prefer ttyUSB1 which is more stable on this system)
def _auto_detect_serial():
    import glob
    for p in ["/dev/ttyUSB1", "/dev/ttyUSB0", "/dev/ttyACM0", "/dev/ttyACM1"]:
        if os.path.exists(p):
            return p
    ports = glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*")
    return ports[0] if ports else "/dev/ttyUSB0"

SERIAL_PORT = os.getenv("SERIAL_PORT", _auto_detect_serial())
BAUD_RATE = 115200
CALIBRATION_FILE = Path(__file__).parent / "calibration.json"

# ---------------------------------------------------------------------------
# Quota-aware backoff — automatically throttle when Firestore returns 429
# ---------------------------------------------------------------------------
class QuotaTracker:
    """Global exponential backoff for Firestore 429 / timeout errors.
    
    Maintains per-operation backoff counters and a global 'quota_ok' flag.
    Any successful Firestore call should call .success() to reset the flag.
    Any 429/timeout should call .fail(op_name) to engage backoff.
    """
    BACKOFF_STEPS = [5, 15, 30, 60, 120, 300]  # seconds

    def __init__(self):
        self._counters: dict[str, int] = {}       # op -> consecutive fail count
        self._backoff_until: dict[str, float] = {} # op -> timestamp to resume
        self.quota_ok = True                       # global: any op succeeding?
        self._consec_global_fails = 0

    def should_skip(self, op: str) -> bool:
        return time.time() < self._backoff_until.get(op, 0)

    def fail(self, op: str, err: Exception | str = ""):
        n = self._counters.get(op, 0) + 1
        self._counters[op] = n
        idx = min(n - 1, len(self.BACKOFF_STEPS) - 1)
        wait = self.BACKOFF_STEPS[idx]
        self._backoff_until[op] = time.time() + wait
        self._consec_global_fails += 1
        if self._consec_global_fails >= 3:
            self.quota_ok = False
        print(f"    → backoff {op} for {wait}s (fail #{n})")

    def success(self, op: str = ""):
        if op:
            self._counters[op] = 0
            self._backoff_until[op] = 0
        self._consec_global_fails = 0
        self.quota_ok = True

    def current_wait(self, op: str) -> int:
        until = self._backoff_until.get(op, 0)
        remaining = until - time.time()
        return max(0, int(remaining))

quota = QuotaTracker()


def _is_quota_error(e: Exception) -> bool:
    """Return True if the error is a Firestore quota / rate-limit / overload issue."""
    s = str(e)
    return any(k in s for k in ("429", "Quota", "RESOURCE_EXHAUSTED", "503", "504", "Deadline"))


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


# ---------------------------------------------------------------------------
# Serial sensor ingestion — reads ESP32 JSON lines and POSTs to /api/ingest
# ---------------------------------------------------------------------------
# ESP32 serial keys → API ingest keys mapping
_SERIAL_KEY_MAP = {
    "temp": "temperature_c",
    "humidity": "humidity",
    "tds": "tds_ppm",
    "ph_v": "ph_voltage_v",
    "do_v": "do_voltage_v",
    "tds_v": "tds_voltage_v",
}
_serial_ingest_interval = 5  # POST to /api/ingest every 5s (not every line)
_last_serial_ingest_ts = 0
_last_serial_readings = {}  # latest parsed readings from serial

def _serial_reader_thread():
    """Background thread: read ESP32 serial JSON, POST to /api/ingest periodically."""
    global _last_serial_ingest_ts, _last_serial_readings
    import requests

    print("  📡 Serial sensor reader thread started")
    while True:
        try:
            with serial_lock:
                ser = get_serial()
                if not ser:
                    time.sleep(2)
                    continue
                # Read all available lines (non-blocking, timeout=1 already set)
                lines = []
                while ser.in_waiting:
                    try:
                        line = ser.readline().decode('utf-8', errors='ignore').strip()
                        if line:
                            lines.append(line)
                    except Exception:
                        break

            # Parse JSON sensor lines
            for line in lines:
                if not line.startswith('{'):
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue

                readings = data.get("readings")
                if not readings or not isinstance(readings, dict):
                    continue

                # Map serial keys to API keys
                mapped = {}
                for sk, ak in _SERIAL_KEY_MAP.items():
                    if sk in readings:
                        mapped[ak] = readings[sk]

                if mapped:
                    _last_serial_readings = mapped

            # POST to /api/ingest periodically
            now = time.time()
            if _last_serial_readings and (now - _last_serial_ingest_ts >= _serial_ingest_interval):
                _last_serial_ingest_ts = now
                try:
                    payload = {
                        "device": "esp32-serial",
                        "key": "espkey123",
                        "readings": dict(_last_serial_readings),
                    }
                    resp = requests.post(
                        "http://localhost:5000/api/ingest",
                        json=payload,
                        timeout=5,
                    )
                    if resp.ok:
                        r = resp.json()
                        if r.get("inserted", 0) > 0:
                            print(f"  📡 Serial→API: {r.get('inserted')} readings ingested")
                    else:
                        print(f"  ⚠️ Serial ingest error: HTTP {resp.status_code}")
                except Exception as e:
                    print(f"  ⚠️ Serial ingest error: {e}")

        except Exception as e:
            print(f"  ⚠️ Serial reader error: {e}")

        time.sleep(1)  # Read serial every 1s

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
            resp = requests.post(api_url, timeout=5)  # Increased timeout for reliability
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
        # Start background serial reader thread
        serial_thread = threading.Thread(target=_serial_reader_thread, daemon=True)
        serial_thread.start()
        print("✅ Serial sensor reader thread started")
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
    
    # Initial calibration sync (non-fatal — gRPC cold start can be slow)
    try:
        sync_calibration_to_firebase(db)
        print("✅ Calibration synced to Firebase")
    except Exception as e:
        print(f"⚠️ Initial cal sync failed (will retry later): {e}")
        if _is_quota_error(e):
            quota.fail("cal_update", e)
    
    sync_count = 0
    
    while True:
        try:
            sync_count += 1
            ts_str = datetime.now().strftime('%H:%M:%S')

            # When quota is NOT ok, slow the loop to avoid hammering
            if not quota.quota_ok:
                relay_wait = quota.current_wait("relay")
                print(f"[{ts_str}] ⏳ Quota exhausted — waiting {relay_wait}s before retry...")
                time.sleep(max(SYNC_INTERVAL, relay_wait))
                # Probe with a lightweight read to see if quota recovered
                try:
                    from google.api_core.retry import Retry as _Retry
                    _probe_retry = _Retry(deadline=5, initial=0.5, maximum=2)
                    db.collection("relay_commands").limit(1).get(
                        timeout=5, retry=_probe_retry
                    )
                    quota.success("probe")
                    print(f"  ✅ Quota recovered!")
                except Exception as e:
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("relay", e)  # keeps escalating backoff
                        continue  # skip this cycle entirely
                    # Non-quota error (DNS etc) — also back off
                    print(f"  ⚠️ Probe failed (non-quota): {e}")
                    time.sleep(SYNC_INTERVAL)
                    continue

            print(f"[{ts_str}] Sync #{sync_count}...")
            
            # === PRIORITY 1: Relay commands (every cycle, ~5s) ===
            # 17,280 reads/day — acceptable at 50% quota target
            if not quota.should_skip("relay"):
                try:
                    had_commands = process_relay_commands(db)
                    quota.success("relay")
                    if had_commands:
                        sync_relay_status_to_firebase(db)
                except Exception as e:
                    print(f"  ⚠️ Relay error: {e}")
                    if _is_quota_error(e):
                        quota.fail("relay", e)
                    elif "Timeout" in str(e):
                        quota.fail("relay", e)  # timeout likely means 429-throttled
            
            # NOTE: Latest readings pushed directly by api.py on ingest
            # Backup: also push from here every 3rd cycle (~15s) in case api.py push fails
            if sync_count % 3 == 0 and not quota.should_skip("latest"):
                try:
                    pushed = sync_latest_to_firebase(db, session)
                    if pushed:
                        quota.success("latest")
                except Exception as e:
                    print(f"  ⚠️ Latest sync error: {e}")
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("latest", e)
            
            # === LOW PRIORITY: Override mode every 6th cycle (~30s) ===
            if sync_count % 6 == 0 and not quota.should_skip("override"):
                try:
                    last_override_state = check_override_mode(db, last_override_state)
                    quota.success("override")
                except Exception as e:
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("override", e)
            
            # === LOW PRIORITY: Cal mode every 12th cycle (~60s) ===
            if sync_count % 12 == 0 and not quota.should_skip("calmode"):
                try:
                    last_cal_mode_state = check_calibration_mode(db, last_cal_mode_state)
                    quota.success("calmode")
                except Exception as e:
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("calmode", e)
            
            # === History sync every 60th cycle (~5min), skip if paused or quota bad ===
            # At BATCH_SIZE=10 every 5min ≈ 2,880 writes/day (fits Spark plan)
            if (sync_count % 60 == 0
                    and quota.quota_ok
                    and os.getenv("FIREBASE_PAUSE_HISTORY", "0") != "1"):
                try:
                    new_ts = sync_history_to_firebase(db, session, last_sync_ts)
                    if new_ts > last_sync_ts:
                        last_sync_ts = new_ts
                        save_last_sync_ts(last_sync_ts)
                    new_act_ts = sync_actuator_events_to_firebase(db, session, last_actuator_sync_ts)
                    if new_act_ts > last_actuator_sync_ts:
                        last_actuator_sync_ts = new_act_ts
                except Exception as e:
                    print(f"  ⚠️ History sync error: {e}")
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("history", e)
            
            # === Calibration updates every 15th cycle ===
            if sync_count % 15 == 0 and not quota.should_skip("cal_update"):
                try:
                    last_cal_check = check_calibration_updates(db, last_cal_check)
                    quota.success("cal_update")
                except Exception as e:
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("cal_update", e)
            
            time.sleep(SYNC_INTERVAL)
            
        except KeyboardInterrupt:
            print("\n👋 Stopping Firebase sync...")
            break
        except Exception as e:
            print(f"  ❌ Error: {e}")
            time.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    main()
