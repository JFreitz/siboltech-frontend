#!/usr/bin/env python3
"""Read sensor readings from an ESP32 over USB serial and store into the local DB.

ESP32 should print ONE JSON object per line, example:

{"device":"esp32-1","ts":"2026-01-08T12:34:56Z","readings":{"temperature_c":24.12,"humidity":55.1}}

This script will:
- parse each line as JSON
- write one row per (sensor,value) into sensor_readings
- optionally sync to cloud after N messages

Usage:
  source ~/sensor-venv/bin/activate
  python ingest_serial.py --port /dev/ttyACM0 --baud 115200

If --port is omitted, the script tries to auto-detect /dev/ttyACM* or /dev/ttyUSB*.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

import serial  # pyserial

from db import SensorReading, init_db, get_session


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: Any) -> datetime:
    if not value:
        return _utcnow()
    if isinstance(value, (int, float)):
        # seconds since epoch
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    if isinstance(value, str):
        s = value.strip()
        # Accept ISO8601 with Z
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


def _http_post_json(url: str, token: str | None, payload: dict[str, Any], timeout_s: float = 10.0) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw or "{}")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code}: {detail}".strip())
    except Exception as e:
        raise RuntimeError(str(e))


def autodetect_port() -> str | None:
    # Prefer ACM (CDC) then USB serial.
    candidates = sorted(glob.glob("/dev/ttyACM*")) + sorted(glob.glob("/dev/ttyUSB*"))
    return candidates[0] if candidates else None


def readings_to_rows(payload: dict[str, Any]) -> list[SensorReading]:
    device = payload.get("device") or payload.get("id") or "esp32"
    ts = _parse_ts(payload.get("ts") or payload.get("timestamp"))
    readings = payload.get("readings") or {}
    if not isinstance(readings, dict):
        return []

    # Normalize sensor names from ESP32 format to our standard format
    # ESP32 sends: temp, humidity, tds, ph_v, do_v, tds_v
    # We store:    temperature_c, humidity, tds_ppm, ph, do_mg_l
    name_map = {
        "temp": "temperature_c",
        "temperature": "temperature_c",
        "tds": "tds_ppm",
        "ph_v": "ph_voltage_v",
        "do_v": "do_voltage_v",
        "tds_v": "tds_voltage_v",
    }
    normalized_readings = {}
    for k, v in readings.items():
        new_key = name_map.get(k, k)
        normalized_readings[new_key] = v

    # If the ESP32 sends only raw voltages (e.g. ph_voltage_v) we can compute
    # the calibrated value on the Pi using calibration.json.
    computed_readings = dict(normalized_readings)
    if "ph" not in computed_readings and "ph_voltage_v" in computed_readings:
        try:
            from calibration import calibrate_ph

            v_ph = float(computed_readings.get("ph_voltage_v"))
            computed_readings["ph"] = float(calibrate_ph(v_ph))
        except Exception:
            # Keep going; we can still store other sensors.
            pass

    if "do_mg_l" not in computed_readings and "do_voltage_v" in computed_readings:
        try:
            from calibration import calibrate_do

            v_do = float(computed_readings.get("do_voltage_v"))
            computed_readings["do_mg_l"] = float(calibrate_do(v_do))
        except Exception:
            pass

    meta_base: dict[str, Any] = {
        "source": "esp32_usb",
        "device": device,
    }

    # Default sensors stored.
    # Override by setting ALLOWED_SENSORS="sensor1,sensor2".
    allowed = os.getenv("ALLOWED_SENSORS", "temperature_c,humidity,tds_ppm,ph,do_mg_l")
    allowed_sensors = {s.strip() for s in allowed.split(",") if s.strip()}

    units = {
        "temperature_c": "C",
        "humidity": "%",
        "tds_ppm": "ppm",
        "ph": "pH",
        "do_mg_l": "mg/L",
    }

    tds_voltage_v = None
    try:
        if isinstance(computed_readings, dict) and "tds_voltage_v" in computed_readings:
            tds_voltage_v = float(computed_readings.get("tds_voltage_v"))
    except Exception:
        tds_voltage_v = None

    ph_voltage_v = None
    try:
        if isinstance(computed_readings, dict) and "ph_voltage_v" in computed_readings:
            ph_voltage_v = float(computed_readings.get("ph_voltage_v"))
    except Exception:
        ph_voltage_v = None

    do_voltage_v = None
    try:
        if isinstance(computed_readings, dict) and "do_voltage_v" in computed_readings:
            do_voltage_v = float(computed_readings.get("do_voltage_v"))
    except Exception:
        do_voltage_v = None

    rows: list[SensorReading] = []
    for sensor, value in computed_readings.items():
        sensor_name = str(sensor)
        if allowed_sensors and sensor_name not in allowed_sensors:
            continue
        try:
            v = float(value)
        except Exception:
            continue

        meta = meta_base
        if sensor_name == "tds_ppm" and tds_voltage_v is not None:
            meta = dict(meta_base)
            meta["tds_voltage_v"] = tds_voltage_v

        if sensor_name == "ph" and ph_voltage_v is not None:
            meta = dict(meta)
            meta["ph_voltage_v"] = ph_voltage_v

        if sensor_name == "do_mg_l" and do_voltage_v is not None:
            meta = dict(meta)
            meta["do_voltage_v"] = do_voltage_v

        rows.append(
            SensorReading(
                timestamp=ts,
                sensor=sensor_name,
                value=v,
                unit=units.get(sensor_name),
                meta=meta,
            )
        )

    return rows


def maybe_sync(message_count: int, every_n: int) -> None:
    if every_n <= 0:
        return
    if message_count % every_n != 0:
        return

    try:
        from sync import sync_to_cloud

        sync_to_cloud()
    except Exception as e:
        print(f"Sync skipped/failed: {e}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default=os.getenv("ESP32_SERIAL_PORT"), help="e.g. /dev/ttyACM0")
    parser.add_argument("--baud", type=int, default=int(os.getenv("ESP32_BAUD", "115200")))
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Don't write to the DB; just read/print serial lines (useful for smoke testing USB serial).",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Print every line received (including non-JSON).",
    )
    parser.add_argument(
        "--sync-every",
        type=int,
        default=int(os.getenv("SYNC_EVERY_N_MESSAGES", "0")),
        help="(Legacy) Run sync.py after N messages (0 disables). Use CLOUD_INGEST_URL for real-time HTTP ingest.",
    )
    parser.add_argument(
        "--cloud-url",
        default=os.getenv("CLOUD_INGEST_URL", ""),
        help="Railway ingest URL, e.g. https://<app>.up.railway.app/api/ingest (or set CLOUD_INGEST_URL)",
    )
    parser.add_argument(
        "--ingest-token",
        default=os.getenv("INGEST_TOKEN", ""),
        help="Bearer token for /api/ingest (or set INGEST_TOKEN). Leave empty if your ingest is open.",
    )
    parser.add_argument(
        "--cloud-timeout",
        type=float,
        default=float(os.getenv("CLOUD_INGEST_TIMEOUT_SECONDS", "10")),
        help="HTTP timeout seconds for cloud ingest.",
    )
    args = parser.parse_args()

    port = args.port or autodetect_port()
    if not port:
        print("No serial port found. Plug in ESP32 and try again.")
        return 2

    if not args.no_db:
        init_db()
    print(f"Listening on {port} @ {args.baud} baud")

    cloud_url = (args.cloud_url or "").strip()
    ingest_token = (args.ingest_token or "").strip() or None
    if cloud_url:
        print(f"Cloud ingest enabled -> {cloud_url}")

    msg_count = 0
    while True:
        try:
            with serial.Serial(port, args.baud, timeout=1) as ser:
                ser.reset_input_buffer()
                while True:
                    line = ser.readline().decode("utf-8", errors="replace").strip()
                    if not line:
                        continue

                    if args.raw:
                        print(line)

                    if args.no_db:
                        continue

                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        # Allow occasional non-JSON logs.
                        continue

                    rows = readings_to_rows(payload)
                    if not rows:
                        continue

                    if cloud_url:
                        # Send the raw ESP32 payload to the cloud API (real-time).
                        # Ensure a timestamp exists for better ordering.
                        if "ts" not in payload and "timestamp" not in payload:
                            payload = dict(payload)
                            payload["ts"] = _utcnow().isoformat().replace("+00:00", "Z")
                        try:
                            result = _http_post_json(cloud_url, ingest_token, payload, timeout_s=args.cloud_timeout)
                            inserted = result.get("inserted")
                            if inserted is not None:
                                print(f"Cloud ingest ok (inserted={inserted})")
                        except Exception as e:
                            print(f"Cloud ingest failed (kept local backup): {e}")

                    session = get_session()
                    try:
                        for row in rows:
                            session.add(row)
                        session.commit()
                    finally:
                        session.close()

                    msg_count += 1
                    print(f"Saved {len(rows)} readings (messages={msg_count})")
                    maybe_sync(msg_count, args.sync_every)

        except serial.SerialException as e:
            print(f"Serial error: {e}. Retrying in 2s...")
            time.sleep(2)
        except KeyboardInterrupt:
            print("\nStopped.")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
