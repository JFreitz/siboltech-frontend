# Relay 3 (pH Up) Pin Reassignment - Migration Guide

**Date:** February 12, 2026  
**Issue:** GPIO 17 relay stuck ON even when commanded OFF  
**Solution:** Reassign relay 3 to GPIO 27

---

## Summary of Changes

| Parameter | Old Value | New Value | Reason |
|-----------|-----------|-----------|--------|
| Relay 3 Pin | GPIO 17 | GPIO 27 | GPIO 17 stuck LOW (hardware failure) |
| RELAY_PINS[2] | 17 | 27 | Index 2 = relay 3 |

---

## Files Modified

### 1. ESP32 Firmware
**File:** `esp32-bme280-usb/src/main.cpp` (Line 33)

**Before:**
```cpp
static const int RELAY_PINS[] = {19, 18, 17, 23, 14, 15, 12, 26, 13};
```

**After:**
```cpp
static const int RELAY_PINS[] = {19, 18, 27, 23, 14, 15, 12, 26, 13};
```

### 2. Python Automation Controller
**File:** `Despro/automation.py` (Line 18-19)

**Before:**
```python
# Chan 1=pin19, 2=pin18, 3=pin17, ...
```

**After:**
```python
# Chan 1=pin19, 2=pin18, 3=pin27, ...
# Note: Relay 3 (pH Up) reassigned from GPIO 17 to GPIO 27 (GPIO 17 hardware failure)
```

---

## Hardware Changes Required

### Physical Wiring Change

**Old Connection:**
- Relay Module CH3 → ESP32 GPIO 17

**New Connection:**
- Relay Module CH3 → ESP32 GPIO 27

### GPIO 27 Specifications
- **Type:** General Purpose I/O
- **Voltage:** 3.3V
- **Current Capability:** ~40 mA
- **Pull-up/Pull-down:** Supports both
- **Restrictions:** None for relay control

### Verification
- GPIO 27 is **NOT** used by:
  - I2C (pins 21, 22)
  - ADC sensors (pins 32, 34, 35)
  - Other relays (pins 12-15, 18-19, 23, 26)

---

## Upload & Test Procedure

### Step 1: Update Hardware Wiring
```bash
1. Disconnect ESP32 from USB/power
2. Move the relay 3 cable from GPIO 17 to GPIO 27
3. Verify no other cables on GPIO 27
4. Reconnect ESP32 to USB
```

### Step 2: Upload New Firmware
```bash
cd /home/username/Documents/PlatformIO/Projects/esp32-bme280-usb
pio run -e esp32dev -t upload
```

**Expected Output:**
```
Uploading .pio/build/esp32dev/firmware.bin
Writing at 0x00010000... (X%)
....
Hash of data verified.
```

### Step 3: Monitor Serial for Verification
```bash
pio device monitor --baud 115200
```

**Expected to see:**
```
Relays initialized (GPIO 12-15,17-19,23,26)
[Note: Change comment to include 27, or just verify relay initialization]
```

### Step 4: Test Relay 3 Control
```bash
# Via API
curl -X POST http://192.168.100.72:5000/api/relay/3/on
sleep 1
curl -X POST http://192.168.100.72:5000/api/relay/3/off

# Or via serial (if monitor is running)
# Type: R3 ON
# Then: R3 OFF
```

### Step 5: Verify Status
```bash
# Check dashboard UI - pH Up button should toggle correctly
# Or check API:
curl http://192.168.100.72:5000/api/relay/status | jq '.relays[] | select(.id==3)'
```

---

## Rollback Procedure (If Issues Occur)

**If relay 3 still doesn't work after the change:**

1. Change GPIO 27 back to GPIO 17 in firmware
2. Try another pin (GPIO 2, 4, 5, or 25)
3. Or physically swap relay channels (use CH4 instead of CH3)

**Alternative pins available:**
- GPIO 2 (good choice)
- GPIO 4 (good choice)
- GPIO 5 (good choice)
- GPIO 25 (good choice)

---

## Verification Checklist

After uploading new firmware:

- [ ] ESP32 boots successfully (serial monitor shows startup messages)
- [ ] Relay 1, 2, 4-9 still work correctly
- [ ] Relay 3 turns ON when API sends `/api/relay/3/on`
- [ ] Relay 3 turns OFF when API sends `/api/relay/3/off`
- [ ] Relay 3 holds OFF state (doesn't get stuck ON)
- [ ] pH Up button on dashboard works
- [ ] Database logs relay state changes

---

## Diagnosis Summary

**Why GPIO 17 Failed:**
- Possible causes:
  1. ESD damage from electrostatic discharge
  2. Over-current from relay inductive kickback
  3. Voltage spike on relay control line
  4. Stuck internal transistor (stuck LOW)

**Why GPIO 27 Works:**
- Fresh GPIO with no history of failure
- Same electrical characteristics as GPIO 17
- Not used by other subsystems

---

## Commit & Backup

```bash
# Backup old firmware
cp esp32-bme280-usb/src/main.cpp esp32-bme280-usb/src/main.cpp.backup.170_to_27

# Commit changes
git add -A
git commit -m "Fix relay 3: reassign GPIO 17 → GPIO 27 (hardware failure)"
git push origin master
```

---

## Future Prevention

To prevent relay damage in the future:
1. Add **protection diodes** across relay coils (1N4007)
2. Use **opto-isolators** on relay control lines
3. Add **ferrite beads** on relay coil wires
4. Ensure proper **grounding** on relay module

---

**Questions?** Check `/tmp/api.log` for relay command execution logs.
