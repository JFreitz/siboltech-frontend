# AI Coding Agent Instructions for SIBOLTECH Sensor Collector

## Architecture Overview

This is a **distributed IoT sensor collection system** with three main components:

1. **ESP32 Firmware** (`esp32-bme280-usb/`): Acquires sensor data (BME280, ADS1115 ADC for pH/TDS/DO), controls 8 relays, communicates via serial/WiFi
2. **Raspberry Pi Collector** (`Despro/`): Aggregates readings from ESP32 over serial, persists to local SQLite/Postgres, syncs to cloud
3. **Cloud Stack**: Railway (Postgres), Vercel (dashboard), Flask API, MQTT (HiveMQ)

**Data Flow**: ESP32 sensors → Serial/USB → RPi collector → Local DB → Cloud sync (Railway) → Flask API → Vercel dashboard

## Critical Developer Workflows

### Local Development

```bash
# RPi side: Create venv and install
python3 -m venv ~/sensor-venv
source ~/sensor-venv/bin/activate
pip install -r requirements.txt

# Database setup (SQLite default, or Postgres)
export DATABASE_URL=postgresql://user:pass@host/db
python collector.py  # Main sensor read loop

# Control relays via serial
python relay_control.py R1 ON  # Single relay
python relay_control.py STATUS  # Check all relay states
```

### ESP32 Build & Upload

```bash
# Using PlatformIO (configured in platformio.ini)
pio run -e esp32dev -t upload
pio device monitor --baud 115200
```

### Key Commands to Know

- **Collector start**: `python collector.py` → reads sensors every 30s, persists to DB, syncs to cloud
- **Serial ingestion** (alt to collector): `python ingest_serial.py --port /dev/ttyUSB0` → streams JSON from ESP32
- **Cloud sync**: `python sync.py` → copies local DB rows to Railway
- **API server**: `python api.py` → Flask server on port 5000, serves `/api/latest`, `/api/readings`, relay endpoints
- **Calibration**: Load/save via `calibration.py` → JSON file with per-sensor slope/offset (linear model)

## Project-Specific Conventions & Patterns

### Sensor Calibration (Linear Model)

```python
# calibration.json structure:
{
  "ph": {"slope": 4.24, "offset": 0.0},
  "tds": {"slope": 606.06, "offset": 0.0},
  "do": {"slope": 4.24, "offset": 0.0}
}

# Usage: value = slope * voltage + offset
# Update via calibration.py::update_calibration(sensor, [(voltage, measured_value), ...])
```

### Sensor Reading Storage

All readings stored as `SensorReading(timestamp, sensor, value, unit, meta)` in DB:
- Metadata includes: source (BME280 vs ADS1115), raw voltages for analog probes
- Default 30s sampling interval (configurable in `collector.py::SAMPLE_INTERVAL`)
- Supports mock data when hardware unavailable (see `sensors.py`)

### Serial Protocol (ESP32 ↔ RPi)

**Commands (RPi → ESP32)**:
```
R1 ON/OFF          # Control relay 1-8
ALL ON/OFF         # All relays
STATUS             # Get relay states
HELP               # Show commands
```

**Responses (JSON, one per line)**:
```json
{"device":"esp32-wroom32","readings":{"temp":24.12,"humidity":55.1,"tds":150.5}}
{"relay":1,"state":"ON"}
{"relay_status":[{"relay":1,"state":"ON"},{"relay":2,"state":"OFF"},...]}
```

**Response Latency**: Serial commands processed with **100ms polling** on ESP32 (configurable `RELAY_POLL_INTERVAL`). Critical: relay commands are **highest priority** in main loop (before WiFi/sensor reads).

### Cloud Synchronization

- **HTTP-based sync** (`sync.py`): Copies new rows from local DB to Railway via HTTP API
- **Fallback**: If Railway internal URL fails, tries via ngrok/Cloudflare tunnel
- **Timestamp tracking**: `.last_http_sync_ts` file prevents re-syncing same rows
- Railway URL stored in `CLOUD_DATABASE_URL` env var

### Configuration via Environment Variables

```bash
DATABASE_URL           # Local DB (defaults to SQLite)
CLOUD_DATABASE_URL     # Railway Postgres
DISPLAY_TIMEZONE       # Default "Asia/Manila" (used in API responses)
MQTT_BROKER            # HiveMQ Cloud endpoint (optional, for future MQTT relay commands)
```

## Integration Points & External Dependencies

### Hardware
- **BME280**: I2C (addr 0x76/0x77), provides temp/humidity/pressure
- **ADS1115**: I2C ADC (16-bit), channels 0-2 → pH/TDS/DO probes
- **8-channel Relay**: GPIO 12-19 (Active-LOW, pull HIGH = OFF, LOW = ON)
- **Serial**: 115200 baud, USB CDC on ESP32

### Libraries
- **ESP32**: Arduino, Adafruit_BME280, ArduinoJson, HTTPClient, WiFi
- **RPi**: SQLAlchemy (ORM), Flask, pyserial, adafruit-circuitpython (BME280, ADS1115)
- **Cloud**: Railway (Postgres), HiveMQ (MQTT optional), Cloudflare Tunnel (free ingress)

### API Endpoints

```
GET  /api/latest                    # Latest readings (all sensors)
GET  /api/readings?sensor=ph&limit=100  # Historical readings
POST /api/ingest                    # Accept readings from ESP32
GET  /api/relay/pending             # Check pending relay commands
POST /api/relay/set                 # Set relay state
```

## Common Issues & Patterns

1. **Relay response lag**: Check ESP32 loop priority (serial commands must process before sensor reads). See `main.cpp::loop()`.
2. **Calibration drift**: Manual two-point calibration required; stored in JSON, applied in `sensors.py::read_analog()`.
3. **WiFi dropouts**: ESP32 reconnects every 10s if disconnected; check SSID/password in `main.cpp` config.
4. **Cloud sync failures**: Verify `CLOUD_DATABASE_URL` and railway tunnel connectivity; check `.last_http_sync_ts` state file.
5. **Mock sensor data**: If hardware unavailable, `sensors.py` returns test values; disable with `if not ads: return {}` check.

## Key Files to Reference

- [Collector main loop](Despro/collector.py) - 30s sampling, DB persistence, cloud sync trigger
- [Sensor reading functions](Despro/sensors.py) - BME280 + ADS1115 with calibration applied
- [Calibration system](Despro/calibration.py) - Linear model load/save
- [ESP32 firmware](esp32-bme280-usb/src/main.cpp) - Serial command processing, relay control, WiFi/sensor polling
- [Python relay CLI](Despro/relay_control.py) - Serial communication wrapper
- [Flask API](Despro/api.py) - REST endpoints, DB queries, MQTT publish
- [Cloud sync](Despro/sync.py) - HTTP-based data replication to Railway
