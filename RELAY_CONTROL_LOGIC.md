# SIBOLTECH Relay Control Logic - Complete Documentation

**Updated:** February 12, 2026

## Summary

All relay control issues have been identified and fixed. Relays will **no longer stay ON indefinitely**.

---

## ✅ Changes Made

### 1. **Fixed API Endpoint Path Issues** (index.js)

**Bug:** JavaScript was calling wrong endpoints:
- ❌ `/relay/status` (404 error)
- ❌ `/relay/{id}/{action}` (404 error)

**Fix:** Updated to correct paths:
- ✅ `/api/relay/status`
- ✅ `/api/relay/{id}/on` and `/api/relay/{id}/off`

**Impact:** Relay commands now properly logged to database and status syncs with UI every 3 seconds.

---

### 2. **Unified Relay Timing Constants** (automation.py)

Changed to consistent 2-second pulse with 30-second intervals:

| Setting | Before | After | Purpose |
|---------|--------|-------|---------|
| `PH_DOSE_TIME` | 3 sec | **2 sec** | pH relay ON duration |
| `PH_COOLDOWN` | 60 sec | **30 sec** | pH relay OFF interval (wait before next check) |
| `TDS_DOSE_ON` | 5 sec | **2 sec** | TDS/Leafy Green ON duration (consistent with other nutrients) |
| `TDS_DOSE_OFF` | 30 sec | 30 sec | TDS OFF interval (no change needed) |

Manual buttons (index.js):
- `NUTRIENT_PULSE_DURATION = 2000` ms (2 seconds) ✅
- `NUTRIENT_AUTO_COOLDOWN = 30000` ms (30 seconds) ✅

---

## 🎯 Relay Behavior Now

### A. **Manual Button Press** (pH Up, pH Down, Leafy Green buttons)

```
Timeline:
  t=0:      Button clicked
  t=0:      Relay turns ON
  t=2 sec:  Relay automatically turns OFF (frontend timer)
  t=2-32:   Cooldown period (button disabled)
  t=32:     Button re-enabled
```

**Code Path:**
1. User clicks "pH Up" button (Relay 3)
2. `setupNutrientButtons()` handler fires
3. Sends `POST /api/relay/3/on`
4. Sets timeout for 2000ms (2 seconds)
5. Sends `POST /api/relay/3/off`
6. Button disabled for 2.5 seconds total

**File:** `index.js` lines 2650-2700

---

### B. **Automation Control** (RPi-based, triggered by sensor readings)

```
Timeline (when pH is too low and < PH_LOW threshold):
  t=0:          pH filter ready, reads ph < 5.5 (PH_LOW)
  t=0:          `PH_UP` relay turns ON
  t=0:          `ph_dosing_until` timer = now + 2 sec (PH_DOSE_TIME)

  t=2 sec:      Relay ON duration elapsed
  t=2:          `PH_UP` relay turns OFF
  t=2:          `ph_dosing_until` timer = now + 30 sec (PH_COOLDOWN)

  t=32 sec:     Cooldown elapsed
  t=32:         Next check occurs:
                - If pH still < 5.5: pulse again (2 sec ON, 30 sec OFF)
                - If pH >= 5.8 (PH_HIGH hysteresis): stop
```

**Code Path:**
1. Automation loop calls `_process_automation()` every iteration
2. Gets filtered pH reading
3. Checks: `if ph < PH_LOW and now > self.ph_dosing_until:`
4. Sets relay ON
5. Records `ph_dosing_until = now + 2` (PH_DOSE_TIME)
6. Next iteration (when time elapsed):
7. Checks: `elif self.relays["PH_UP"].state and now >= self.ph_dosing_until:`
8. Sets relay OFF
9. Records `ph_dosing_until = now + 30` (PH_COOLDOWN for waiting before re-check)

**File:** `automation.py` lines 57-60, 338-357

---

### C. **TDS Dosing** (Leafy Green nutrient, Relay 1)

**Same pattern as pH**, but with:
- `TDS_DOSE_ON = 2` seconds (ON duration)
- `TDS_DOSE_OFF = 30` seconds (OFF interval between pulses)

Triggers when TDS < 675 ppm, stops when TDS >= 800 ppm.

**File:** `automation.py` lines 385-415

---

### D. **Manual Override Mode**

**When enabled:**
- Automation is suspended
- User can toggle relays via UI checkboxes
- Relay stays ON as long as checkbox is checked
- Relay turns OFF when checkbox is unchecked

**When disabled (Auto mode):**
- Automation controls relays based on sensors
- UI checkboxes become unresponsive (read-only)
- Relays pulse according to automation timings

**Control:** Toggle "🎛️ Manual Control" at bottom of dashboard

**File:** `api.py` lines 1215-1245

---

## 📊 Relay Mapping

| Relay ID | Label | Pin | Function | Auto-Control |
|----------|-------|-----|----------|--------------|
| 1 | Leafy Green | 19 | TDS nutrient dosing | ✅ By TDS |
| 2 | pH Down | 18 | Nutrient (acid) | ✅ By pH |
| 3 | pH Up | 17 | Nutrient (base) | ✅ By pH |
| 4 | Misting Pump | 23 | Hydration spray | ✅ By cycle |
| 5 | Exhaust Fan (Out) | 14 | CO2 exhaust | ✅ By temp/humidity |
| 6 | Grow Lights (Aero) | 15 | Aeroponics lights | ✅ By schedule |
| 7 | Air Pump | 12 | DO / oxygenation | ✅ By dissolved oxygen |
| 8 | Grow Lights (DWC) | 26 | DWC lights | ✅ By schedule |
| 9 | Exhaust Fan (In) | 13 | Fresh air intake | ✅ By temp/humidity |

---

## 🔍 Verification

### Check Manual Pulse (2 seconds ON, then OFF)

```bash
# Send pH Up ON
curl -X POST http://192.168.100.72:5000/api/relay/3/on

# Wait 2 seconds
sleep 2

# Send OFF (or wait for frontend to send it)
curl -X POST http://192.168.100.72:5000/api/relay/3/off

# Verify status
curl http://192.168.100.72:5000/api/relay/status | jq '.relays[] | select(.id==3)'
```

### Check Automation Cycles

```bash
# Enable override to see clean automation
curl -X POST http://192.168.100.72:5000/api/override-mode -d '{"enabled": false}'

# Disable override to enable automation
curl -X POST http://192.168.100.72:5000/api/override-mode -d '{"enabled": false}'

# Monitor relay states
watch -n 1 'curl -s http://192.168.100.72:5000/api/relay/status | jq ".relays[] | {id, label, state}"'
```

### Database Log of Relay Events

```bash
sqlite3 sensors.db << 'EOF'
.mode column
SELECT 
  id, relay_id, state, timestamp 
FROM actuator_events 
WHERE relay_id = 3  -- pH Up
ORDER BY timestamp DESC 
LIMIT 10;
EOF
```

---

## ⚙️ Configuration Files

### Automation Timing (Python)
**File:** `automation.py`

```python
# pH thresholds
PH_LOW = 5.5      # Trigger pH UP when below this
PH_HIGH = 7.0     # Trigger pH DOWN when above this
PH_DOSE_TIME = 2  # Seconds to keep relay ON
PH_COOLDOWN = 30  # Seconds to wait before re-checking

# TDS thresholds
TDS_LOW = 675     # Start Leafy Green dosing
TDS_HIGH = 800    # Stop Leafy Green dosing
TDS_DOSE_ON = 2   # Seconds ON
TDS_DOSE_OFF = 30 # Seconds OFF (between pulses)
```

### Manual Button Timing (JavaScript)
**File:** `index.js`

```javascript
const NUTRIENT_PULSE_DURATION = 2000;   // 2 seconds ON
const NUTRIENT_AUTO_COOLDOWN = 30000;   // 30 seconds OFF
```

---

## 🚨 Troubleshooting

### Relay Stays ON
- **Check 1:** Is "Manual Control" enabled? If yes, toggle checkbox OFF
- **Check 2:** Run `curl -X POST http://192.168.100.72:5000/api/relay/all/off`
- **Check 3:** Check database for stuck events: `sqlite3 sensors.db "SELECT * FROM actuator_events WHERE relay_id = X ORDER BY timestamp DESC LIMIT 5;"`

### Relay Doesn't Turn ON
- **Check 1:** Is automation enabled? Run `curl http://192.168.100.72:5000/api/automation-status`
- **Check 2:** Are sensor values within trigger range?
  - pH trigger: pH < 5.5 (pH UP) or pH > 7.0 (pH DOWN)
  - TDS trigger: TDS < 675 (Leafy Green)
- **Check 3:** Is cooldown period active? Check timestamp in last `ph_dosing_until` or `tds_dose_last_off`

### UI Not Updating After Relay Command
- **Cause:** Status endpoint not being called
- **Fix:** Press Ctrl+F5 in browser to reload frontend (clear cache)
- **Verify:** Open browser DevTools, go to Network tab, look for `/api/relay/status` requests every 3 seconds

---

## 📝 API Endpoints

### Relay Control
```
POST /api/relay/{id}/on       # Turn relay {id} ON
POST /api/relay/{id}/off      # Turn relay {id} OFF
POST /api/relay/all/on        # Turn ALL relays ON
POST /api/relay/all/off       # Turn ALL relays OFF
GET  /api/relay/status        # Get all relay states
```

### Mode Control
```
POST /api/override-mode       # Enable/disable manual mode
  Body: {"enabled": true|false}
```

### Automation Status
```
GET  /api/automation-status   # Get automation status
GET  /api/relay/pending       # Get pending relay commands
```

---

## 🎯 Next Steps

1. **Dashboard:** Reload page to verify UI updates when you click buttons
2. **Manual Test:** Click "pH Up" button, verify relay turns ON then OFF in 2 seconds
3. **Automation Test:** Disable "Manual Control" and let system auto-dose based on sensors
4. **Monitor:** Check `/tmp/api.log` for relay action timestamps

---

**Questions?** Check console logs (F12 → Console) for real-time relay command feedback.
