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
SYNC_INTERVAL = int(os.getenv("FIREBASE_SYNC_INTERVAL", "15"))  # seconds - increased from 5s to reduce quota
BATCH_SIZE = 10  # Keep small to stay within Spark plan (20k writes/day)

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

# Auto-reset: if no serial data for this many seconds, toggle DTR/RTS to reboot ESP32
# WARNING: Resetting ESP32 causes GPIO 15 (grow lights) to flicker OFF during boot
# because GPIO 15 is a strapping pin that gets pulled HIGH (relay OFF) by the boot ROM
# before setup() can restore NVS states. This is a HARDWARE-LEVEL issue.
# DISABLED by default — opt-in via ESP32_AUTO_RESET=1 environment variable.
_ESP32_AUTO_RESET_ENABLED = os.getenv("ESP32_AUTO_RESET", "0") == "1"
_ESP32_AUTO_RESET_AFTER = 120  # seconds of silence before reset
_ESP32_RESET_COOLDOWN = 300    # minimum seconds between resets
_last_esp32_reset_ts = 0       # timestamp of last reset

def _reset_esp32_via_dtr():
    """Reset ESP32 by toggling DTR/RTS lines (same as pressing the RST button)."""
    global serial_conn, _last_esp32_reset_ts
    now = time.time()
    if now - _last_esp32_reset_ts < _ESP32_RESET_COOLDOWN:
        remaining = int(_ESP32_RESET_COOLDOWN - (now - _last_esp32_reset_ts))
        print(f"  ⏳ ESP32 reset cooldown ({remaining}s left), skipping", flush=True)
        return False

    _last_esp32_reset_ts = now
    try:
        with serial_lock:
            ser = get_serial()
            if not ser:
                print("  ❌ Cannot reset ESP32: serial not available", flush=True)
                return False

            print("  🔄 Resetting ESP32 via DTR/RTS toggle...", flush=True)
            # Toggle DTR & RTS low then high (mimics EN/RST button press)
            ser.dtr = False
            ser.rts = False
            time.sleep(0.2)
            ser.dtr = True
            ser.rts = True
            time.sleep(0.2)
            ser.dtr = False
            ser.rts = False
            time.sleep(1.5)  # Wait for ESP32 bootloader
            ser.reset_input_buffer()
            print("  ✅ ESP32 reset complete, waiting for data...", flush=True)
            return True
    except Exception as e:
        print(f"  ❌ ESP32 reset failed: {e}", flush=True)
        return False


def _serial_reader_thread():
    """Background thread: read ESP32 serial JSON, POST to /api/ingest periodically."""
    global _last_serial_ingest_ts, _last_serial_readings
    import requests

    print("  📡 Serial sensor reader thread started", flush=True)
    _no_data_count = 0
    while True:
        try:
            lines = []
            with serial_lock:
                ser = get_serial()
                if not ser:
                    time.sleep(2)
                    continue
                # Read all available lines (non-blocking, timeout=1 already set)
                while ser.in_waiting:
                    try:
                        line = ser.readline().decode('utf-8', errors='ignore').strip()
                        if line:
                            lines.append(line)
                    except Exception:
                        break

            if lines:
                _no_data_count = 0
            else:
                _no_data_count += 1
                if _no_data_count % 10 == 0:
                    print(f"  ⚠️ Serial reader: no data for {_no_data_count}s", flush=True)
                # Auto-reset ESP32 if stuck (disabled by default — causes GPIO 15 strapping flicker)
                if _ESP32_AUTO_RESET_ENABLED and _no_data_count >= _ESP32_AUTO_RESET_AFTER:
                    print(f"  🚨 ESP32 appears stuck (no data for {_no_data_count}s), attempting auto-reset", flush=True)
                    if _reset_esp32_via_dtr():
                        _no_data_count = 0  # Reset counter after successful reset
                elif not _ESP32_AUTO_RESET_ENABLED and _no_data_count >= _ESP32_AUTO_RESET_AFTER and _no_data_count % 60 == 0:
                    print(f"  ⚠️ ESP32 silent for {_no_data_count}s (auto-reset disabled, set ESP32_AUTO_RESET=1 to enable)", flush=True)

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


_relay_cmd_override_synced = False  # Track if we've already synced override for this batch

def process_relay_commands(db: firestore.Client):
    """Check for pending relay commands and execute them via API.
    Returns True if any commands were processed."""
    global _relay_cmd_override_synced
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
        
        # Dashboard relay command implies manual control — enable override
        # so automation doesn't immediately overwrite the user's action.
        # The override toggle on Vercel syncs via settings/override_mode but
        # that path is slower (checked every 30s). This makes it instant.
        if not _relay_cmd_override_synced:
            try:
                ov_resp = requests.get("http://localhost:5000/api/override-mode", timeout=2)
                if ov_resp.ok and not ov_resp.json().get("enabled", False):
                    requests.post(
                        "http://localhost:5000/api/override-mode",
                        json={"enabled": True},
                        timeout=2,
                    )
                    print("  🔒 Auto-enabled override (dashboard relay command)")
                    _save_override_processed(True)
            except Exception as e:
                print(f"  ⚠️ Could not auto-enable override: {e}")
            _relay_cmd_override_synced = True
        
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
    
    # Reset the flag when no commands (user switched back to auto)
    if not had_commands:
        _relay_cmd_override_synced = False
    
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


_last_processed_override_ts = None  # Track last processed override command timestamp
_OVERRIDE_PROCESSED_FILE = Path(__file__).parent / ".last_override_processed"

def _load_last_override_processed():
    """Load the last processed override state from local file."""
    try:
        if _OVERRIDE_PROCESSED_FILE.exists():
            data = json.loads(_OVERRIDE_PROCESSED_FILE.read_text())
            return data.get("enabled"), data.get("processed_at")
    except Exception:
        pass
    return None, None

def _save_override_processed(enabled: bool):
    """Save that we processed this override command locally."""
    try:
        _OVERRIDE_PROCESSED_FILE.write_text(json.dumps({
            "enabled": enabled,
            "processed_at": datetime.now(timezone.utc).isoformat()
        }))
    except Exception:
        pass

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
            if source == "dashboard":
                # Check if we already processed this same state locally
                # This prevents re-applying stale commands when quota blocks
                # the Firebase doc_ref.update(source="rpi-synced") call
                prev_enabled, _ = _load_last_override_processed()
                if prev_enabled == enabled:
                    return last_override_state  # Already processed this exact state
                
                print(f"  🔒 Override mode changed from dashboard: {'ON' if enabled else 'OFF'}")
                try:
                    resp = requests.post(
                        "http://localhost:5000/api/override-mode",
                        json={"enabled": enabled},
                        timeout=2
                    )
                    if resp.ok:
                        print(f"    → API synced: override={'ON' if enabled else 'OFF'}")
                except Exception as e:
                    print(f"    → API error: {e}")
                
                # Mark as processed locally (works even when Firebase quota is exhausted)
                _save_override_processed(enabled)
                
                # NOTE: Skipping Firebase source update to save quota writes
                # (was: doc_ref.update({"source": "rpi-synced"}))
                
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
                        # NOTE: Skipping source update to save quota writes
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
                    # NOTE: Skipping source reset to save quota writes
                return update_time
    
    return last_cal_check


def sync_history_to_firebase(db: firestore.Client, session, last_sync_ts: datetime) -> datetime:
    """Sync 15-minute aggregated sensor averages to Firebase history collection.

    Instead of syncing individual readings (which can never catch up with
    thousands of new rows per hour), this computes 15-min averages in SQL
    and writes one compact document per bucket.  Quota cost: ≤48 writes
    per sync (covers 12 hours of data) vs old approach that could never
    finish a multi-day backlog.
    """
    from sqlalchemy import func as sa_func

    SENSOR_TYPES = ("ph", "do_mg_l", "tds_ppm", "temperature_c", "humidity")
    SENSOR_UNITS = {
        "ph": "pH", "do_mg_l": "mg/L", "tds_ppm": "ppm",
        "temperature_c": "°C", "humidity": "%",
    }
    MAX_BUCKETS_PER_SYNC = 48  # ≤48 writes per sync to stay quota-friendly

    # Ensure last_sync_ts is timezone-aware
    if last_sync_ts.tzinfo is None:
        last_sync_ts = last_sync_ts.replace(tzinfo=timezone.utc)

    # Only process complete 15-min buckets (don't include the current one)
    now_utc = datetime.now(timezone.utc)
    # Truncate to current 15-min boundary so we only sync completed buckets
    cutoff = now_utc.replace(
        minute=(now_utc.minute // 15) * 15, second=0, microsecond=0
    )

    if cutoff <= last_sync_ts:
        return last_sync_ts  # Nothing new to sync yet

    # Query sensor readings between last_sync and cutoff (only relevant sensors)
    readings = (
        session.query(
            SensorReading.sensor,
            SensorReading.timestamp,
            SensorReading.value,
        )
        .filter(
            SensorReading.timestamp > last_sync_ts,
            SensorReading.timestamp <= cutoff,
            SensorReading.sensor.in_(SENSOR_TYPES),
        )
        .order_by(SensorReading.timestamp.asc())
        .yield_per(500)  # Stream in chunks to avoid loading millions into memory
    )

    # Bucket readings into 15-min windows in Python
    buckets = {}  # key: bucket_start_iso -> {sensor: [values]}
    for sensor, ts, value in readings:
        if value is None:
            continue
        # Make tz-aware
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        # Compute bucket start (floor to 15 min)
        bucket_start = ts.replace(
            minute=(ts.minute // 15) * 15, second=0, microsecond=0
        )
        bk = bucket_start.isoformat()
        if bk not in buckets:
            buckets[bk] = {"ts": bucket_start, "sensors": {}}
        if sensor not in buckets[bk]["sensors"]:
            buckets[bk]["sensors"][sensor] = []
        buckets[bk]["sensors"][sensor].append(value)

    if not buckets:
        return last_sync_ts

    # Sort by time, limit to MAX_BUCKETS_PER_SYNC oldest buckets first
    sorted_keys = sorted(buckets.keys())[:MAX_BUCKETS_PER_SYNC]

    batch = db.batch()
    batch_count = 0
    latest_bucket_end = last_sync_ts

    for bk in sorted_keys:
        data = buckets[bk]
        bucket_ts = data["ts"]

        # Average each sensor's values for this 15-min window
        readings_map = {}
        for sensor, values in data["sensors"].items():
            avg_val = sum(values) / len(values)
            readings_map[sensor] = {
                "value": round(avg_val, 4),
                "unit": SENSOR_UNITS.get(sensor, ""),
            }

        # Doc ID like "2026-02-23T10-00-00_00-00" (safe for Firestore)
        doc_id = bucket_ts.isoformat().replace(":", "-").replace("+", "_")
        doc_ref = (
            db.collection("sensors")
            .document("history")
            .collection("readings")
            .document(doc_id)
        )
        doc_data = {
            "timestamp": bucket_ts.isoformat(),
            "readings": readings_map,
        }
        batch.set(doc_ref, doc_data)
        batch_count += 1

        # Track the END of this bucket (bucket_start + 15 min)
        bucket_end = bucket_ts + timedelta(minutes=15)
        if bucket_end > latest_bucket_end:
            latest_bucket_end = bucket_end

    if batch_count > 0:
        batch.commit(timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
        print(f"  📊 Synced {batch_count} history buckets (15-min avg) to Firebase")

    # Return the end of the last synced bucket so next call starts right after
    return latest_bucket_end


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


def sync_plant_predictions_to_firebase(db: firestore.Client, session):
    """Sync ML plant predictions and historical plant measurements to Firebase."""
    try:
        # Query latest plant measurements
        plant_data = (
            session.query(
                "plant_id",
                "timestamp",
                "height_cm",
                "weight_g",
                "leaf_count",
                "branch_count"
            )
            .from_statement(
                """SELECT 
                    plant_id, MAX(timestamp) as timestamp,
                    height_cm, weight_g, leaf_count, branch_count
                FROM plant_measurements
                GROUP BY plant_id
                ORDER BY plant_id ASC"""
            )
            .all()
        )
        
        if not plant_data:
            return
        
        # Get latest sensor readings for predictions
        try:
            sensor_data = {}
            sensor_rows = session.execute(
                """SELECT sensor, value FROM sensor_readings 
                   WHERE sensor IN ('ph', 'do', 'tds', 'temperature', 'humidity')
                   ORDER BY timestamp DESC LIMIT 5"""
            ).fetchall()
            for sensor, value in sensor_rows:
                if sensor not in sensor_data:
                    sensor_data[sensor] = float(value)
        except:
            sensor_data = {}
        
        # Try to load ML models and generate predictions
        predictions = {}
        try:
            import sys
            import importlib.util
            ml_file = Path(__file__).parent / "ML_MODEL_SUMMARY" / "05_predict_new_data.py"
            if ml_file.exists():
                spec = importlib.util.spec_from_file_location("predictor", ml_file)
                predictor_mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(predictor_mod)
                
                predictor = predictor_mod.PlantGrowthPredictor()
                
                # Generate predictions for each farming system
                for system in ["dwc", "aeroponics"]:
                    plant_ids = [1, 2, 3, 4, 5, 6] if system == "dwc" else [101, 102, 103, 104, 105, 106]
                    for plant_id in plant_ids:
                        pred = predictor.predict(
                            ph=sensor_data.get('ph', 7.0),
                            do=sensor_data.get('do', 8.0),
                            tds=sensor_data.get('tds', 800),
                            temperature=sensor_data.get('temperature', 25),
                            humidity=sensor_data.get('humidity', 60),
                            plant_id=plant_id
                        )
                        if pred:
                            predictions[f"{system}_{plant_id}"] = pred
        except Exception as e:
            print(f"  ⚠️ Warning: Could not load ML models: {e}")
        
        # Sync to Firebase
        batch = db.batch()
        batch_count = 0
        
        # Sync plant measurements to predictions/latest
        for row in plant_data:
            try:
                plant_id, ts, height, weight, leaves, branches = row
                # Derive farming system from plant_id: 1-6 = DWC, 101-106 = Aeroponics
                plant_id_int = int(plant_id)
                farming_system = "aeroponics" if plant_id_int >= 100 else "dwc"
                
                pred_key = f"{farming_system}_{plant_id}"
                pred = predictions.get(pred_key, {})
                
                doc_ref = db.collection("predictions").document("latest").collection("plants").document(f"{farming_system}_{plant_id}")
                doc_data = {
                    "plant_id": str(plant_id),
                    "farming_system": farming_system,
                    "timestamp": ts.isoformat() if hasattr(ts, 'isoformat') else str(ts),
                    "actual": {
                        "height_cm": float(height) if height else 0,
                        "weight_g": float(weight) if weight else 0,
                        "leaf_count": int(leaves) if leaves else 0,
                        "branch_count": int(branches) if branches else 0,
                    },
                    "predicted": pred,
                    "sensors": sensor_data,
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                }
                batch.set(doc_ref, doc_data)
                batch_count += 1
            except Exception as e:
                print(f"  ⚠️ Error syncing plant {row[0]}: {e}")
        
        if batch_count > 0:
            batch.commit(timeout=FIRESTORE_TIMEOUT, retry=FIRESTORE_RETRY)
            print(f"  🌱 Synced {batch_count} plant predictions to Firebase")
    
    except Exception as e:
        print(f"  ⚠️ Error syncing plant predictions: {e}")


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

    # Start serial proxy server (port 5001) so api.py can send relay commands
    # through firebase_sync's serial connection without opening the port itself
    def _start_serial_proxy():
        from flask import Flask, request, jsonify
        proxy = Flask("serial-proxy")
        proxy.logger.disabled = True
        import logging
        logging.getLogger('werkzeug').setLevel(logging.ERROR)
        
        @proxy.route("/serial/send", methods=["POST"])
        def serial_send():
            data = request.get_json(force=True)
            cmd = data.get("command", "")
            if not cmd:
                return jsonify({"error": "No command"}), 400
            result = send_relay_command(cmd)
            return jsonify({"result": result})
        
        proxy.run(host="127.0.0.1", port=5001, debug=False, use_reloader=False)
    
    proxy_thread = threading.Thread(target=_start_serial_proxy, daemon=True)
    proxy_thread.start()
    print("✅ Serial proxy on port 5001")
    import time as _time
    _time.sleep(1)  # Give Flask time to start
    
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
    # If last sync is too old, fast-forward to 48 hours ago to skip massive
    # backlogs that would waste quota on stale data.  History now uses 15-min
    # aggregation, so 48h = max 192 buckets — catches up in one sync cycle.
    max_backlog = datetime.now(timezone.utc) - timedelta(hours=48)
    if last_sync_ts < max_backlog:
        print(f"  ⏩ History sync was {last_sync_ts.isoformat()} — fast-forwarding to 48h ago")
        last_sync_ts = max_backlog
        save_last_sync_ts(last_sync_ts)
    # Fast-forward actuator sync: only sync recent events (last 3 days)
    # to avoid wasting quota on thousands of old events
    actuator_min_ts = datetime.now(timezone.utc) - timedelta(days=3)
    saved_ts = load_last_sync_ts()
    last_actuator_sync_ts = max(saved_ts, actuator_min_ts)
    last_cal_check = datetime.now(timezone.utc) - timedelta(hours=1)
    # Read current override state from local API (not Firebase) to avoid
    # re-applying stale dashboard commands on every restart
    last_override_state = False
    try:
        print("[DEBUG] Attempting to GET override-mode from API...")
        import requests as _req
        _resp = _req.get("http://localhost:5000/api/override-mode", timeout=2)
        print(f"[DEBUG] API responded: {_resp.status_code}")
        if _resp.ok:
            last_override_state = _resp.json().get("enabled", False)
            print(f"Current override state from API: {'ON' if last_override_state else 'OFF'}")
            # Sync local state TO Firebase to clear any stale dashboard commands
            # This prevents re-applying old override commands after restart
            # NOTE: Skip this on startup since Firebase quota is often exhausted
            # It will sync in the main loop
    except Exception as e:
        print(f"[DEBUG] Failed to get override state from API: {e}")
        pass  # API not ready yet, default to False
    last_cal_mode_state = False  # Track calibration mode from dashboard
    print(f"Last sync: {last_sync_ts.isoformat()}")
    print(f"Sync interval: {SYNC_INTERVAL}s")
    print("-" * 50)
    
    # Initial calibration sync (non-fatal — gRPC cold start can be slow)
    # SKIP on startup to avoid blocking — will sync in main loop
    print("[DEBUG] Skipping initial calibration sync (will sync in main loop)")
    
    sync_count = 0
    
    # Initialize and start automation controller
    print("[DEBUG] Starting automation controller initialization...")
    try:
        from automation import init_controller
        print("[DEBUG] Successfully imported init_controller")
        
        def relay_callback(relay_id: int, state: bool):
            """Callback to set relay state via API with retry."""
            try:
                import requests as _req
                action = "on" if state else "off"
                # Increased timeout to 5s + retry logic for resilience
                for attempt in range(2):
                    try:
                        _resp = _req.post(f"http://localhost:5000/api/relay/{relay_id}/{action}", timeout=5)
                        if _resp.ok:
                            return  # Success
                        elif _resp.status_code == 504:  # Deadline exceeded, retry
                            if attempt == 0:
                                import time as _t
                                _t.sleep(0.1)
                                continue
                        else:
                            print(f"⚠️ Relay {relay_id} set failed: {_resp.status_code}")
                            return
                    except Exception as e:
                        if attempt == 0 and "timeout" in str(e).lower():
                            import time as _t
                            _t.sleep(0.1)
                            continue
                        raise
            except Exception as e:
                print(f"⚠️ Relay {relay_id} callback error: {e}")
        
        print("[DEBUG] Creating automation controller...")
        controller = init_controller(relay_callback)
        print("[DEBUG] Starting automation controller thread...")
        controller.start()
        print("✅ Automation controller started")
    except Exception as e:
        import traceback
        print(f"⚠️ Failed to start automation controller: {e}")
        traceback.print_exc()
    
    print("[DEBUG] About to enter main sync loop...")
    
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
            
            # === PRIORITY 1: Relay commands (every 2 cycles, ~30s) ===
            # ~5,760 checks/day (~3% of quota if commands present)
            # DISABLED temporarily while quota recovers - relay commands can wait until quota resets
            # if sync_count % 2 == 0 and not quota.should_skip("relay"):
            #     try:
            #         had_commands = process_relay_commands(db)
            #         quota.success("relay")
            #         # Don't sync relay status after every command - too many writes!
            #         # Will be synced in history updates (every 15 min)
            #         # if had_commands:
            #         #     sync_relay_status_to_firebase(db)
            #     except Exception as e:
            #         print(f"  ⚠️ Relay error: {e}")
            #         if _is_quota_error(e):
            #             quota.fail("relay", e)
            #         elif "Timeout" in str(e):
            #             quota.fail("relay", e)  # timeout likely means 429-throttled
            
            # NOTE: Latest readings pushed directly by api.py on ingest (every 30s)
            # Removed redundant backup push from here to save Firebase writes quota
            
            # === LOW PRIORITY: Override mode every 8th cycle (~120s) ===
            if sync_count % 8 == 0 and not quota.should_skip("override"):
                try:
                    last_override_state = check_override_mode(db, last_override_state)
                    quota.success("override")
                except Exception as e:
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("override", e)
            
            # === LOW PRIORITY: Cal mode every 20th cycle (~300s = 5 min) ===
            if sync_count % 20 == 0 and not quota.should_skip("calmode"):
                try:
                    last_cal_mode_state = check_calibration_mode(db, last_cal_mode_state)
                    quota.success("calmode")
                except Exception as e:
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("calmode", e)
            
            # === History sync every 180th cycle (~15min), skip if paused or quota bad ===
            # Uses 15-min aggregated averages — typically ≤1 new bucket per sync
            # (~96 writes/day steady state, up to 48 for initial catch-up)
            # Also run on cycle 6 (30s after start) for a fast first sync
            if ((sync_count % 180 == 0 or sync_count == 6)
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
                    # Also sync plant predictions on this cycle
                    sync_plant_predictions_to_firebase(db, session)
                except Exception as e:
                    print(f"  ⚠️ History sync error: {e}")
                    if _is_quota_error(e) or "Timeout" in str(e):
                        quota.fail("history", e)
            
            # === Calibration updates every 40th cycle (~10 min) ===
            if sync_count % 40 == 0 and not quota.should_skip("cal_update"):
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
