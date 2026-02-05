# SIBOLTECH Sensor System - Startup Guide

## Quick Start (After Reboot)

The system auto-starts via systemd services. No manual intervention needed!

### Services Running:
- **siboltech.service** - Flask API on port 5000
- **sensor-collector.service** - ESP32 serial data ingestion
- **firebase-sync.service** - Syncs data to Firebase for Vercel dashboard

### Access Points:
| Location | URL |
|----------|-----|
| Local Dashboard | http://192.168.100.72:5000 |
| Local Mobile | http://192.168.100.72:5000/mobile.html |
| Vercel Dashboard | https://siboltech-frontend.vercel.app |

## Manual Commands

```bash
# Check service status
sudo systemctl status siboltech
sudo systemctl status sensor-collector
sudo systemctl status firebase-sync

# View logs
journalctl -u siboltech -f
journalctl -u sensor-collector -f
journalctl -u firebase-sync -f

# Restart services
sudo systemctl restart siboltech
sudo systemctl restart sensor-collector
sudo systemctl restart firebase-sync
```

## Data Flow

```
ESP32 (sensors/relays)
    |
    v Serial USB
RPi Collector (sensor-collector.service)
    |
    v SQLite DB
Flask API (siboltech.service)
    |
    v Read by
Firebase Sync (firebase-sync.service)
    |
    v Firestore
Vercel Dashboard (real-time)
```

## Relay Control Flow

```
Vercel Dashboard
    |
    v Firebase relay_commands
Firebase Sync (reads commands)
    |
    v POST /api/relay/{id}/{state}
Flask API (updates relay_states)
    |
    v ESP32 polls /api/relay/pending
ESP32 (actuates relays)
```

## Troubleshooting

**Sensors not updating on Vercel:**
```bash
# Check Firebase sync is running
sudo systemctl status firebase-sync
journalctl -u firebase-sync -f

# Check API has data
curl http://localhost:5000/api/latest
```

**Relays not responding:**
```bash
# Check relay states
curl http://localhost:5000/api/relay/pending

# Test relay control
curl -X POST http://localhost:5000/api/relay/1/on
```

**ESP32 not connected:**
```bash
# Check USB connection
ls -la /dev/ttyUSB*

# Check sensor-collector
sudo systemctl status sensor-collector
```

## File Locations

| File | Purpose |
|------|---------|
| /home/username/Despro/api.py | Flask API server |
| /home/username/Despro/firebase_sync.py | Firebase sync service |
| /home/username/Despro/sensors.db | Local SQLite database |
| /home/username/Despro/calibration.json | Sensor calibration values |
| /home/username/Despro/logs/ | Service logs |

## Service Files

```bash
# Install/update services
sudo cp siboltech-api.service /etc/systemd/system/siboltech.service
sudo cp firebase-sync.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable siboltech firebase-sync
```
