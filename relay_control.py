#!/usr/bin/env python3
"""
Simple relay control script for ESP32.
Usage:
  python relay_control.py R1 ON
  python relay_control.py R1 OFF
  python relay_control.py ALL ON
  python relay_control.py ALL OFF
  python relay_control.py STATUS
  python relay_control.py        # Interactive mode
"""

import serial
import sys
import time

SERIAL_PORT = "/dev/ttyUSB0"
BAUD_RATE = 115200

def send_command(ser, cmd):
    """Send a command and print the response with minimal latency."""
    ser.write((cmd + "\n").encode())
    ser.flush()  # Flush immediately to ensure transmission
    time.sleep(0.01)  # Reduced from 0.1s to 0.01s
    
    # Read response with timeout
    start = time.time()
    while (time.time() - start) < 0.5:  # Total read timeout: 500ms
        if ser.in_waiting:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                print(line)
                start = time.time()  # Reset timeout on each successful read
        else:
            time.sleep(0.001)  # Small sleep to avoid busy-waiting

def main():
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(0.5)  # Wait for connection
        
        # Clear any pending data
        ser.reset_input_buffer()
        
        if len(sys.argv) > 1:
            # Command line mode: join all args as the command
            cmd = " ".join(sys.argv[1:])
            send_command(ser, cmd)
        else:
            # Interactive mode
            print("=" * 50)
            print("ESP32 Relay Control - Interactive Mode")
            print("=" * 50)
            print("Commands:")
            print("  R1 ON / R1 OFF  - Control relay 1 (R1-R8)")
            print("  ALL ON / ALL OFF - Control all relays")
            print("  STATUS          - Show relay states")
            print("  HELP            - Show ESP32 help")
            print("  quit / exit     - Exit")
            print("=" * 50)
            
            while True:
                try:
                    cmd = input("\nRelay> ").strip()
                    if not cmd:
                        continue
                    if cmd.lower() in ('quit', 'exit', 'q'):
                        print("Goodbye!")
                        break
                    send_command(ser, cmd)
                except KeyboardInterrupt:
                    print("\nGoodbye!")
                    break
        
        ser.close()
        
    except serial.SerialException as e:
        print(f"Error: {e}")
        print("Make sure the ESP32 is connected and no other program is using the serial port.")
        sys.exit(1)

if __name__ == "__main__":
    main()
