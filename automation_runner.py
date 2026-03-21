#!/usr/bin/env python3
"""
Simple automation runner for SIBOLTECH
Runs automation controller with relay API callback
"""

import sys
sys.path.insert(0, '/home/username/Despro')

from automation import AutomationController
from sqlalchemy import text
from db import get_session
import requests
import time

def set_relay(relay_id, state):
    """Set relay via API"""
    try:
        endpoint = f"http://localhost:5000/api/relay/{relay_id}/{'on' if state else 'off'}"
        requests.post(endpoint, timeout=2)
    except:
        pass

def get_latest_sensors():
    """Read latest sensor values from database"""
    try:
        session = get_session()
        readings = {}
        
        sensors = {
            "temperature_c": "temperature_c",
            "humidity": "humidity",
            "ph": "ph",
            "do_mg_per_l": "do_mg_l",
            "tds_ppm": "tds_ppm"
        }
        
        for db_sensor, auto_key in sensors.items():
            result = session.execute(text(
                "SELECT value FROM sensor_readings WHERE sensor = :s ORDER BY timestamp DESC LIMIT 1"
            ), {"s": db_sensor}).fetchone()
            
            if result:
                readings[auto_key] = result[0]
        
        session.close()
        return readings
    except Exception as e:
        return {}

# Start automation
controller = AutomationController(relay_callback=set_relay)
controller.start()

print("[AUTOMATION] Running (misting: 10s ON / 3m OFF, lights: 6am-6pm)")

# Keep thread alive
try:
    while True:
        # Read actual sensor data from database
        sensors = get_latest_sensors()
        if sensors:
            controller.update_sensors(sensors)
        time.sleep(1)  # Update every second for responsive automation
except KeyboardInterrupt:
    controller.stop()
    print("[AUTOMATION] Stopped")
