#!/usr/bin/env python3
"""
Relay Control API for SIBOLTECH
Runs locally to communicate with ESP32 via serial for actuator control.
"""

import serial
import time
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from frontend

# Serial port configuration
SERIAL_PORT = "/dev/ttyUSB0"
BAUD_RATE = 115200

# Relay labels matching SIBOLTECH actuators
RELAY_LABELS = {
    1: "Misting Pump",
    2: "Air Pump",
    3: "Exhaust Fan (In)",
    4: "Exhaust Fan (Out)",
    5: "Grow Lights (Aeroponics)",
    6: "Grow Lights (DWC)",
    7: "pH Up",
    8: "pH Down"
}

# Store relay states (in memory)
relay_states = {i: False for i in range(1, 9)}

def send_command(command):
    """Send command to ESP32 via serial and get response."""
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
        time.sleep(0.1)
        ser.flushInput()
        ser.write(f"{command}\n".encode())
        time.sleep(0.3)
        response = ""
        while ser.in_waiting:
            response += ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            time.sleep(0.05)
        ser.close()
        return {"success": True, "response": response.strip()}
    except serial.SerialException as e:
        return {"success": False, "error": f"Serial error: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.route("/")
def index():
    return jsonify({"name": "SIBOLTECH Relay API", "status": "running"})

@app.route("/relay/status")
def get_all_status():
    result = send_command("STATUS")
    if result["success"]:
        response = result["response"]
        states = {}
        for i in range(1, 9):
            if f"R{i}: ON" in response:
                states[i] = True
                relay_states[i] = True
            elif f"R{i}: OFF" in response:
                states[i] = False
                relay_states[i] = False
            else:
                states[i] = relay_states[i]
        
        return jsonify({
            "success": True,
            "relays": [{"id": i, "label": RELAY_LABELS[i], "state": states[i]} for i in range(1, 9)]
        })
    else:
        return jsonify({
            "success": False,
            "error": result.get("error", "Unknown error"),
            "relays": [{"id": i, "label": RELAY_LABELS[i], "state": relay_states[i]} for i in range(1, 9)]
        })

@app.route("/relay/<int:relay_id>/on", methods=["POST"])
def turn_relay_on(relay_id):
    if relay_id < 1 or relay_id > 8:
        return jsonify({"success": False, "error": "Invalid relay ID (1-8)"}), 400
    
    result = send_command(f"R{relay_id} ON")
    if result["success"]:
        relay_states[relay_id] = True
        return jsonify({"success": True, "relay": relay_id, "state": True})
    return jsonify(result), 500

@app.route("/relay/<int:relay_id>/off", methods=["POST"])
def turn_relay_off(relay_id):
    if relay_id < 1 or relay_id > 8:
        return jsonify({"success": False, "error": "Invalid relay ID (1-8)"}), 400
    
    result = send_command(f"R{relay_id} OFF")
    if result["success"]:
        relay_states[relay_id] = False
        return jsonify({"success": True, "relay": relay_id, "state": False})
    return jsonify(result), 500

@app.route("/relay/all/on", methods=["POST"])
def turn_all_on():
    result = send_command("ALL ON")
    if result["success"]:
        for i in range(1, 9):
            relay_states[i] = True
        return jsonify({"success": True, "message": "All relays ON"})
    return jsonify(result), 500

@app.route("/relay/all/off", methods=["POST"])
def turn_all_off():
    result = send_command("ALL OFF")
    if result["success"]:
        for i in range(1, 9):
            relay_states[i] = False
        return jsonify({"success": True, "message": "All relays OFF"})
    return jsonify(result), 500

if __name__ == "__main__":
    print("=" * 50)
    print("  SIBOLTECH Relay Control API")
    print("=" * 50)
    print(f"  Serial: {SERIAL_PORT} @ {BAUD_RATE}")
    print("  API: http://localhost:5001")
    print("=" * 50)
    for i, label in RELAY_LABELS.items():
        print(f"  R{i}: {label}")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5001, debug=False)
