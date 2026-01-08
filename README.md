# Sensor collector (RPi5)

Minimal project to read BME280 (I2C) and three analog probes (pH, TDS, DO) via ADS1115 and save to a local SQL database.

Quick start:

1. Enable I2C on the Raspberry Pi (`raspi-config` -> Interface Options -> I2C).
2. Create and activate venv, then install packages:

```bash
python3 -m venv ~/sensor-venv
source ~/sensor-venv/bin/activate
pip install -r requirements.txt
```

3. Configure DB: use SQLite (default) or run Postgres (Docker example):

```bash
docker run --name sensor-postgres -e POSTGRES_USER=sensor -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=sensordb -p 5432:5432 -d postgres:15
export DATABASE_URL=postgresql://sensor:secret@localhost:5432/sensordb
```

4. Run collector:

```bash
source ~/sensor-venv/bin/activate
python collector.py
```

Files:
- `sensors.py` — sensor reads (uses calibrated functions)
- `calibration.py` — calibration data and functions
- `db.py` — SQLAlchemy model and DB init
- `collector.py` — main loop to persist readings
- `sync.py` — sync local data to cloud DB
- `export_ml.py` — export data to CSV for ML
- `.env.example` — env var examples

Next steps: calibrate probes, sync to Railway, host API on Railway for Vercel dashboard, use cloud data for ML.

## Cloud Setup (Railway + Vercel)

1. **Railway DB:**
   - Sign up at railway.app, create project, add Postgres.
   - Get DATABASE_URL from Railway dashboard.

2. **Sync local to cloud:**
   - Set `CLOUD_DATABASE_URL` in .env to Railway URL.
   - Run: `python sync.py`

3. **Deploy API on Railway:**
   - Push `api.py` + `requirements.txt` to GitHub.
   - Connect Railway to repo, set DATABASE_URL env var.
   - API endpoints: `/api/readings` (all), `/api/latest` (per sensor).

4. **Vercel Dashboard:**
   - Create Next.js app, fetch from Railway API URL.
   - Example: `fetch('https://your-railway-api.up.railway.app/api/latest')`

## Sync to Cloud

Set `CLOUD_DATABASE_URL` to your Railway Postgres URL, then:

```bash
python sync.py
```

Run periodically (e.g., cron) to push local data to cloud.

### If your Railway DB host is internal-only

If your Postgres URL host ends with `.railway.internal`, it is only reachable from inside Railway.

In that case, deploy the API to Railway and sync via HTTP ingest instead:

- On Railway (API service): set `DATABASE_URL` (internal is fine) and `INGEST_TOKEN`.
- On the Pi: set `CLOUD_INGEST_URL` to `https://<your-app>.up.railway.app/api/ingest` and the same `INGEST_TOKEN`.

`sync.py` will automatically use HTTP ingest when `CLOUD_INGEST_URL` is set (or when `CLOUD_DATABASE_URL` is Railway-internal).

## Export for ML

```bash
python export_ml.py  # Creates sensor_data.csv
```

## Calibration

Calibrate probes using known standards:

1. Measure voltage at known values (e.g., pH 4 and 10).
2. Update `calibration.py`:
   ```python
   from calibration import update_calibration
   update_calibration("ph", [(voltage1, value1), (voltage2, value2)])
   ```
3. Data saves to `calibration.json`.

Example:
```bash
python -c "from calibration import update_calibration; update_calibration('ph', [(1.0, 4.0), (2.0, 10.0)])"
```
