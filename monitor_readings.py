#!/usr/bin/env python3
"""
Real-time sensor reading monitor - track API latency
Shows how long between ESP32 sending data and it appearing on dashboard
"""

import requests
import time
from datetime import datetime
import json

API_URL = "http://localhost:5000/api/latest"

def get_readings():
    """Fetch latest readings from API"""
    try:
        resp = requests.get(API_URL, timeout=2)
        if resp.ok:
            return resp.json()
    except Exception as e:
        print(f"Error: {e}")
    return None

def print_readings(data):
    """Pretty print sensor readings with timestamp"""
    if not data:
        print("No data")
        return
    
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    
    ph = data.get('ph', {}).get('value', '?')
    tds = data.get('tds_ppm', {}).get('value', '?')
    do = data.get('do_mg_l', {}).get('value', '?')
    temp = data.get('temperature_c', {}).get('value', '?')
    humidity = data.get('humidity', {}).get('value', '?')
    
    print(f"[{timestamp}] pH: {ph:>6} | TDS: {tds:>7} ppm | DO: {do:>5} mg/L | Temp: {temp:>5}°C | Humidity: {humidity:>5}%")

if __name__ == "__main__":
    print("🔍 Sensor Reading Monitor - Press Ctrl+C to exit")
    print("=" * 90)
    
    last_data = None
    
    while True:
        data = get_readings()
        
        # Check if data changed (new reading)
        if data and data != last_data:
            print_readings(data)
            last_data = data
        
        time.sleep(0.5)  # Check every 500ms
