#!/usr/bin/env python3
"""
Detailed latency tracker: ESP32 → API → Dashboard
Shows timestamps for each stage of the data pipeline
"""

import requests
import time
import subprocess
from datetime import datetime
import json
import threading

API_URL = "http://localhost:5000/api/latest"
LOG_FILE = "/home/username/Despro/logs/api.log"

last_esp32_time = None
last_api_time = None
last_esp32_data = None

def monitor_esp32_logs():
    """Monitor ESP32 data ingestion from logs (background thread)"""
    global last_esp32_time, last_esp32_data
    
    process = subprocess.Popen(
        f"tail -f {LOG_FILE}",
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        bufsize=1
    )
    
    for line in process.stdout:
        if "INGEST" in line and "readings" in line:
            last_esp32_time = datetime.now()
            last_esp32_data = line.strip()
            print(f"\n📡 [ESP32→API] {last_esp32_time.strftime('%H:%M:%S.%f')[:-3]} - Data ingested from ESP32")

def monitor_api():
    """Monitor API endpoint (main thread)"""
    global last_api_time
    
    print("🔍 Latency Monitor - Tracking ESP32 → API → Dashboard")
    print("=" * 80)
    print("Press Ctrl+C to exit\n")
    
    last_value = None
    
    while True:
        try:
            resp = requests.get(API_URL, timeout=1)
            if resp.ok:
                data = resp.json()
                current_value = (
                    data.get('ph', {}).get('value'),
                    data.get('tds_ppm', {}).get('value'),
                    data.get('do_mg_l', {}).get('value')
                )
                
                if current_value != last_value:
                    now = datetime.now()
                    last_api_time = now
                    last_value = current_value
                    
                    # Calculate latency if we have ESP32 timestamp
                    latency = ""
                    if last_esp32_time:
                        delay = (now - last_esp32_time).total_seconds()
                        latency = f" | Latency: {delay:.2f}s"
                    
                    ph, tds, do = current_value
                    print(f"✅ [API Ready] {now.strftime('%H:%M:%S.%f')[:-3]} | pH: {ph:>6} | TDS: {tds:>7} ppm | DO: {do:>5} mg/L{latency}")
        
        except Exception as e:
            print(f"❌ API Error: {e}")
        
        time.sleep(0.5)

if __name__ == "__main__":
    # Start ESP32 log monitor in background
    log_thread = threading.Thread(target=monitor_esp32_logs, daemon=True)
    log_thread.start()
    
    # Run API monitor in main thread
    try:
        monitor_api()
    except KeyboardInterrupt:
        print("\n\n👋 Monitor stopped")
