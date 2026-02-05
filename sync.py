#!/usr/bin/env python3
"""Sync local SQLite data to cloud database via HTTP.

Copies new rows from local `Despro/sensors.db` to the cloud PostgreSQL.
Note: Firebase sync is now handled by firebase_sync.py for Vercel dashboard.
This script is for Railway/PostgreSQL cloud database sync (optional).
"""

import os
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional, List, Dict
from urllib.parse import urlparse
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from db import SensorReading, init_db as init_local_db

load_dotenv()  # Load .env file

def _default_local_sqlite_url() -> str:
    db_path = os.path.join(os.path.dirname(__file__), "sensors.db")
    return f"sqlite:///{db_path}"


# Local SQLite (always the Despro/sensors.db file)
LOCAL_DB_URL = _default_local_sqlite_url()
local_engine = create_engine(LOCAL_DB_URL, echo=False)
LocalSession = sessionmaker(bind=local_engine)

# Cloud PostgreSQL (set in .env or env var)
CLOUD_DB_URL = os.getenv("CLOUD_DATABASE_URL", "postgresql://user:pass@host:5432/dbname")


def _is_railway_internal_host(db_url: str) -> bool:
    try:
        host = urlparse(db_url).hostname or ""
    except Exception:
        return False
    return host.endswith(".railway.internal")


def _default_state_file() -> str:
    return os.path.join(os.path.dirname(__file__), ".last_http_sync_ts")


def _read_last_http_sync_ts(path: str):
    try:
        raw = open(path, "r", encoding="utf-8").read().strip()
    except FileNotFoundError:
        return None
    except Exception:
        return None

    if not raw:
        return None
    s = raw
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            # Be resilient if a previous version wrote naive timestamps.
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _write_last_http_sync_ts(path: str, ts: datetime) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(ts.isoformat())
    os.replace(tmp, path)


def _http_ingest(url: str, token: Optional[str], rows: List[Dict]) -> Dict:
    body = json.dumps({"rows": rows}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode("utf-8")
        return json.loads(payload or "{}")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "ignore")
        except Exception:
            pass
        raise RuntimeError(f"HTTP ingest failed: {e.code} {detail}".strip())
    except Exception as e:
        raise RuntimeError(f"HTTP ingest failed: {e}")

def sync_to_cloud():
    """Copy new readings from local to cloud."""
    cloud_db_url = os.getenv("CLOUD_DATABASE_URL", "")
    cloud_ingest_url = os.getenv("CLOUD_INGEST_URL", "")
    ingest_token = os.getenv("INGEST_TOKEN")

    use_http = bool(cloud_ingest_url) or (cloud_db_url and _is_railway_internal_host(cloud_db_url))

    # Skip if URL is placeholder
    if use_http and cloud_ingest_url and cloud_ingest_url.startswith("https://your-"):
        print("Sync: CLOUD_INGEST_URL is placeholder. Skipping sync.")
        return

    if use_http and not cloud_ingest_url:
        # If you only provided an internal Railway Postgres URL, you must sync via the API.
        print("CLOUD_DATABASE_URL is Railway-internal; set CLOUD_INGEST_URL to sync via HTTP.")
        return

    if not use_http:
        # Don't print full DB URLs (credentials).
        if cloud_db_url:
            print("Sync: CLOUD_DATABASE_URL is set")
        if not cloud_db_url:
            print("CLOUD_DATABASE_URL not set. Skipping sync.")
            return

    if use_http:
        print("Sync: using HTTP ingest")
    else:
        print("Sync: using direct DB")

    if not use_http and (cloud_db_url == "postgresql://user:pass@host:5432/dbname"):
        print("CLOUD_DATABASE_URL not set. Skipping sync.")
        return

    if use_http:
        state_file = os.getenv("SYNC_STATE_FILE", _default_state_file())
        last_sync = _read_last_http_sync_ts(state_file)

        with LocalSession() as local_session:
            query = local_session.query(SensorReading)
            if last_sync:
                query = query.filter(SensorReading.timestamp > last_sync)
            new_readings = query.order_by(SensorReading.timestamp.asc()).all()

        if not new_readings:
            print("No new data to sync.")
            return

        batch_size = int(os.getenv("INGEST_BATCH_SIZE", "250"))
        inserted_total = 0
        skipped_total = 0
        scanned = len(new_readings)
        max_ts = None

        batch: List[Dict] = []
        for reading in new_readings:
            batch.append(
                {
                    "timestamp": reading.timestamp.isoformat() if reading.timestamp else None,
                    "sensor": reading.sensor,
                    "value": reading.value,
                    "unit": reading.unit,
                    "meta": reading.meta,
                }
            )
            if len(batch) >= batch_size:
                result = _http_ingest(cloud_ingest_url, ingest_token, batch)
                inserted_total += int(result.get("inserted", 0) or 0)
                skipped_total += int(result.get("skipped", 0) or 0)
                batch = []

        if batch:
            result = _http_ingest(cloud_ingest_url, ingest_token, batch)
            inserted_total += int(result.get("inserted", 0) or 0)
            skipped_total += int(result.get("skipped", 0) or 0)

        # Advance cursor regardless of inserts; server may skip duplicates.
        max_ts = new_readings[-1].timestamp
        if max_ts:
            _write_last_http_sync_ts(state_file, max_ts)

        print(
            f"Synced to cloud: inserted={inserted_total}, skipped={skipped_total}, scanned={scanned}, mode=http"
        )
        return

    cloud_engine = create_engine(cloud_db_url, echo=False, future=True)
    
    # Create table if not exists
    from db import Base
    Base.metadata.create_all(bind=cloud_engine)
    
    CloudSession = sessionmaker(bind=cloud_engine)

    # Get latest timestamp from cloud
    with CloudSession() as cloud_session:
        result = cloud_session.execute(text("SELECT MAX(timestamp) FROM sensor_readings")).scalar()
        last_sync = result if result else None

    # Get new readings from local
    with LocalSession() as local_session:
        query = local_session.query(SensorReading)
        if last_sync:
            query = query.filter(SensorReading.timestamp > last_sync)
        new_readings = query.all()

    if not new_readings:
        print("No new data to sync.")
        return

    inserted = 0
    skipped = 0
    # Insert into cloud (ORM keeps JSON handling correct across DBs)
    with CloudSession() as cloud_session:
        for reading in new_readings:
            exists = cloud_session.execute(
                text("SELECT 1 FROM sensor_readings WHERE timestamp = :ts AND sensor = :s"),
                {"ts": reading.timestamp, "s": reading.sensor},
            ).fetchone()
            if exists:
                skipped += 1
                continue

            cloud_session.add(
                SensorReading(
                    timestamp=reading.timestamp,
                    sensor=reading.sensor,
                    value=reading.value,
                    unit=reading.unit,
                    meta=reading.meta,
                )
            )
            inserted += 1
        cloud_session.commit()

    print(f"Synced to cloud: inserted={inserted}, skipped={skipped}, scanned={len(new_readings)}")


def main():
    """Run a single sync by default; loop only if SYNC_INTERVAL_SECONDS is set."""
    interval_s = os.getenv("SYNC_INTERVAL_SECONDS")
    if not interval_s:
        sync_to_cloud()
        return

    try:
        interval = float(interval_s)
    except ValueError:
        print(f"Invalid SYNC_INTERVAL_SECONDS={interval_s!r}; running once.")
        sync_to_cloud()
        return

    try:
        while True:
            sync_to_cloud()
            time.sleep(max(interval, 0.1))
    except KeyboardInterrupt:
        print("\nAuto-sync stopped by user.")


if __name__ == "__main__":
    main()