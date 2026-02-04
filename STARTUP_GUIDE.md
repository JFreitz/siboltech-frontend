# SIBOLTECH System Startup Guide

**Last Updated:** February 3, 2026

## Current Working State ✅

- **API Server:** Running on port 5000
- **Tunnel:** https://rid-realize-anne-skip.trycloudflare.com (changes on restart)
- **ESP32:** Connected via WiFi, polling relays every 200ms
- **Sensors:** TDS, pH, BME280 working (DO on 3.3V)
- **Calibration:** pH calibrated (slope=-13.588, offset=37.503)

## Quick Start (Run These Commands)

```bash
# 1. Navigate to project
cd ~/Despro

# 2. Activate Python environment
source ~/sensor-venv/bin/activate

# 3. Start API server (background)
python api.py &

# 4. Start Cloudflare tunnel (background)
cloudflared tunnel --url http://127.0.0.1:5000 > logs/tunnel.log 2>&1 &

# 5. Wait 5 seconds, then get the new tunnel URL
sleep 5 && grep -o 'https://[^"]*trycloudflare.com' logs/tunnel.log | head -1

# 6. Copy that URL and update in:
#    - Vercel dashboard settings (siboltech.vercel.app → Settings gear icon)
#    - Mobile page localStorage (Settings gear icon)
```

## One-Command Startup Script

Run this to start everything:
```bash
cd ~/Despro && ./start_all.sh
```

## ESP32 Setup

The ESP32 connects automatically when powered on:
- **WiFi SSID:** 4G-UFI-6885
- **WiFi Password:** 1234567890
- **RPi IP:** 192.168.100.72
- **API Endpoint:** http://192.168.100.72:5000

**If ESP32 doesn't connect:**
1. Check WiFi is on and RPi has IP 192.168.100.72
2. Power cycle ESP32
3. Monitor serial: `pio device monitor --baud 115200`

## Important URLs

| Service | URL |
|---------|-----|
| Local API | http://127.0.0.1:5000 |
| Tunnel | (new URL each restart - check logs/tunnel_url.txt) |
| Vercel Dashboard | https://siboltech.vercel.app |
| Mobile | {tunnel_url}/mobile.html |

## Verify Everything Works

```bash
# Check API is running
curl http://127.0.0.1:5000/api/latest

# Check tunnel is working
curl $(cat logs/tunnel_url.txt)/api/relay/pending

# Test relay toggle
curl -X POST http://127.0.0.1:5000/api/relay/1/on
```

## Hardware Connections

| Sensor | ESP32 Pin | Notes |
|--------|-----------|-------|
| TDS | GPIO 34 | Analog |
| pH | GPIO 35 | Analog |
| DO | GPIO 32 | Analog, use 3.3V power (5V crashes ESP) |
| BME280 | SDA=21, SCL=22 | I2C |
| Relays | GPIO 19,18,17,23,14,15,12,16,13 | Active LOW |

## Troubleshooting

**API not starting:**
```bash
# Check if port 5000 is in use
lsof -i :5000
# Kill existing process
pkill -f "python api.py"
```

**Tunnel not working:**
```bash
# Check if cloudflared is running
pgrep -f cloudflared
# Restart tunnel
pkill -f cloudflared
cloudflared tunnel --url http://127.0.0.1:5000 > logs/tunnel.log 2>&1 &
```

**ESP32 upload issues:**
```bash
# Use slow upload with no-stub
cd ~/Documents/PlatformIO/Projects/esp32-bme280-usb
~/.platformio/penv/bin/pio run -t upload
```

## Shutdown Procedure

```bash
# Stop all services gracefully
pkill -f cloudflared
pkill -f "python api.py"
```

Or just power off - services will restart on next boot with start_all.sh.
