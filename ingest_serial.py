#!/usr/bin/env python3
"""Read sensor readings from an ESP32 over USB serial and store into the local DB.

ESP32 should print ONE JSON object per line, example:

{"device":"esp32-1","ts":"2026-01-08T12:34:56Z","readings":{"temperature_c":24.12,"humidity":55.1,"pressure_hpa":1008.4}}

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
            return datetime.fromisoformat(s)
        except Exception:
            return _utcnow()
    return _utcnow()


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

    meta_base: dict[str, Any] = {
        "source": "esp32_usb",
        "device": device,
    }

    units = {
        "temperature_c": "C",
        "humidity": "%",
        "pressure_hpa": "hPa",
        "ph": "pH",
        "tds_ppm": "ppm",
        "do_mg_per_l": "mg/L",
    }

    rows: list[SensorReading] = []
    for sensor, value in readings.items():
        try:
            v = float(value)
        except Exception:
            continue

        rows.append(
            SensorReading(
                timestamp=ts,
                sensor=str(sensor),
                value=v,
                unit=units.get(str(sensor)),
                meta=meta_base,
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
        "--sync-every",
        type=int,
        default=int(os.getenv("SYNC_EVERY_N_MESSAGES", "1")),
        help="Sync to cloud after N messages (0 disables)",
    )
    args = parser.parse_args()

    port = args.port or autodetect_port()
    if not port:
        print("No serial port found. Plug in ESP32 and try again.")
        return 2

    init_db()
    print(f"Listening on {port} @ {args.baud} baud")

    msg_count = 0
    while True:
        try:
            with serial.Serial(port, args.baud, timeout=1) as ser:
                ser.reset_input_buffer()
                while True:
                    line = ser.readline().decode("utf-8", errors="replace").strip()
                    if not line:
                        continue

                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        # Allow occasional non-JSON logs.
                        continue

                    rows = readings_to_rows(payload)
                    if not rows:
                        continue

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
