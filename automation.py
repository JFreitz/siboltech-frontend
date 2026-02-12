#!/usr/bin/env python3
"""
SIBOLTECH Automation Controller
Handles automatic relay control based on sensor readings with filtering and hysteresis.
"""

import time
import threading
from datetime import datetime, timedelta
from collections import deque
from typing import Dict, Optional, Callable
import json

# ========== CONFIGURATION ==========

# Relay mapping (1-indexed, matches ESP32 pin wiring)
# Chan 1=pin19, 2=pin18, 3=pin27, 4=pin23, 5=pin14, 6=pin15, 7=pin12, 8=pin26, 9=pin13
# Note: Relay 3 (pH Up) reassigned from GPIO 17 to GPIO 27 (GPIO 17 hardware failure)
RELAY = {
    "LEAFY_GREEN": 1,       # Pin 19
    "PH_DOWN": 2,           # Pin 18
    "PH_UP": 3,             # Pin 27 (was pin 17 - faulty)
    "MISTING": 4,           # Pin 23
    "EXHAUST_OUT": 5,       # Pin 14
    "GROW_LIGHTS_AERO": 6,  # Pin 15
    "AIR_PUMP": 7,          # Pin 12
    "GROW_LIGHTS_DWC": 8,   # Pin 26
    "EXHAUST_IN": 9,        # Pin 13
}

# Filtering: Moving average window size (number of samples)
FILTER_WINDOW_SIZE = 10

# Minimum time between state changes to prevent rapid switching (seconds)
DEBOUNCE_TIME = 5

# ========== THRESHOLDS WITH HYSTERESIS ==========

# DO: Turn ON air pump when < LOW, turn OFF when > HIGH
DO_LOW = 7.0      # mg/L - turn ON air pump
DO_HIGH = 8.5     # mg/L - turn OFF air pump

# Temperature (Morning 6am-6pm)
TEMP_DAY_HIGH = 26.0   # °C - turn ON exhaust
TEMP_DAY_LOW = 23.0    # °C - turn OFF exhaust

# Temperature (Night 6pm-6am)
TEMP_NIGHT_HIGH = 22.0  # °C - turn ON exhaust
TEMP_NIGHT_LOW = 19.0   # °C - turn OFF exhaust

# Humidity
HUMIDITY_HIGH = 70.0    # % - turn ON exhaust
HUMIDITY_LOW = 60.0     # % - turn OFF exhaust

# pH thresholds
PH_LOW = 5.5     # Below this - trigger pH UP
PH_HIGH = 7.0    # Above this - trigger pH DOWN
PH_DOSE_TIME = 2  # seconds to dose (ON time for relay pulse)
PH_COOLDOWN = 30  # seconds to wait after dose before re-checking (OFF interval)

# TDS (Leafy Green nutrient dosing)
TDS_LOW = 675     # ppm - start dosing
TDS_HIGH = 800    # ppm - stop dosing
TDS_DOSE_ON = 2   # seconds ON (pulse duration, matching manual buttons)
TDS_DOSE_OFF = 30 # seconds OFF (interval between pulses)

# Misting cycle
MISTING_ON = 5           # seconds ON
MISTING_OFF = 15 * 60    # 15 minutes OFF (in seconds)

# Grow lights schedule
LIGHTS_ON_HOUR = 6    # 6 AM
LIGHTS_OFF_HOUR = 18  # 6 PM


class SensorFilter:
    """Moving average filter with outlier rejection."""
    
    def __init__(self, window_size: int = FILTER_WINDOW_SIZE):
        self.window_size = window_size
        self.values: deque = deque(maxlen=window_size)
    
    def add(self, value: float) -> float:
        """Add a value and return the filtered result."""
        if value is None or value < 0:
            return self.get()
        
        # Outlier rejection: ignore if > 3 std dev from mean (if enough samples)
        if len(self.values) >= 3:
            mean = sum(self.values) / len(self.values)
            std = (sum((x - mean) ** 2 for x in self.values) / len(self.values)) ** 0.5
            if std > 0 and abs(value - mean) > 3 * std:
                print(f"[FILTER] Rejected outlier: {value:.2f} (mean={mean:.2f}, std={std:.2f})")
                return self.get()
        
        self.values.append(value)
        return self.get()
    
    def get(self) -> float:
        """Get current filtered value."""
        if not self.values:
            return 0.0
        return sum(self.values) / len(self.values)
    
    def ready(self) -> bool:
        """Check if filter has enough samples for reliable output."""
        return len(self.values) >= self.window_size // 2
    
    def fast_ready(self) -> bool:
        """Quick readiness check (2 samples) for safety-critical decisions."""
        return len(self.values) >= 2


class RelayState:
    """Track relay state with debouncing."""
    
    def __init__(self, relay_id: int, name: str):
        self.relay_id = relay_id
        self.name = name
        self.state = False
        self.last_change = 0
        self.pending_off_time: Optional[float] = None  # For timed pulses
    
    def can_change(self) -> bool:
        """Check if enough time has passed since last change."""
        return time.time() - self.last_change >= DEBOUNCE_TIME
    
    def set(self, state: bool, force: bool = False) -> bool:
        """Set state if allowed. Returns True if state was changed."""
        # Always allow if state is unknown (None) or different from target
        if self.state is not None and state == self.state and not force:
            return False
        if not force and self.state is not None and not self.can_change():
            return False
        self.state = state
        self.last_change = time.time()
        return True


class AutomationController:
    """Main automation controller with filtering and hysteresis."""
    
    def __init__(self, relay_callback: Callable[[int, bool], None]):
        """
        Args:
            relay_callback: Function to call to set relay state: callback(relay_id, on_off)
        """
        self.relay_callback = relay_callback
        self.enabled = True
        self.override_mode = False  # When True, automation is disabled
        
        # Filtered sensor values
        self.filters = {
            "temperature": SensorFilter(),
            "humidity": SensorFilter(),
            "ph": SensorFilter(),
            "do": SensorFilter(),
            "tds": SensorFilter(),
        }
        
        # Relay states with debouncing
        self.relays = {name: RelayState(id, name) for name, id in RELAY.items()}
        
        # Pulse timers
        self.misting_last_on = 0
        self.misting_last_off = 0
        self.tds_dosing_active = False
        self.tds_dose_last_on = 0
        self.tds_dose_last_off = 0
        self.ph_dosing_until = 0
        
        # Periodic state enforcement (push all states to callback every N seconds)
        self._last_enforce = 0
        self._ENFORCE_INTERVAL = 10  # seconds
        
        # Thread for background processing
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
    
    def start(self):
        """Start the automation loop in a background thread."""
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        print("[AUTOMATION] Started")
    
    def stop(self):
        """Stop the automation loop."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        print("[AUTOMATION] Stopped")
    
    def set_override(self, override: bool):
        """Enable/disable override mode (manual control)."""
        was_override = self.override_mode
        self.override_mode = override
        print(f"[AUTOMATION] Override mode: {'ON' if override else 'OFF'}", flush=True)
        
        # When override is turned OFF, immediately run automation to restore proper states
        if was_override and not override:
            print("[AUTOMATION] Override disabled - forcing relay state resync", flush=True)
            try:
                # Reset internal relay states to force callback execution
                for relay in self.relays.values():
                    relay.state = None  # Force state to unknown so next set() will trigger callback
                    relay.last_change = 0  # Reset debounce timer
                self._process_automation()
            except Exception as e:
                print(f"[AUTOMATION] Error during immediate cycle: {e}", flush=True)
    
    def update_sensors(self, readings: Dict[str, float]):
        """Update sensor readings (call this whenever new data arrives)."""
        if "temperature_c" in readings:
            self.filters["temperature"].add(readings["temperature_c"])
        if "humidity" in readings:
            self.filters["humidity"].add(readings["humidity"])
        if "ph" in readings:
            self.filters["ph"].add(readings["ph"])
        if "do_mg_l" in readings:
            self.filters["do"].add(readings["do_mg_l"])
        if "tds_ppm" in readings:
            self.filters["tds"].add(readings["tds_ppm"])
    
    def _set_relay(self, name: str, state: bool, force: bool = False):
        """Set relay state through callback."""
        if state is None:
            return
        state = bool(state)
        relay = self.relays[name]
        if relay.set(state, force):
            print(f"[AUTOMATION] {name} -> {'ON' if state else 'OFF'}")
            self.relay_callback(relay.relay_id, state)
    
    def _is_daytime(self) -> bool:
        """Check if current time is daytime (6am-6pm)."""
        hour = datetime.now().hour
        return LIGHTS_ON_HOUR <= hour < LIGHTS_OFF_HOUR
    
    def _loop(self):
        """Main automation loop."""
        while not self._stop_event.is_set():
            try:
                if not self.override_mode:
                    self._process_automation()
                    self._enforce_relay_states()
            except Exception as e:
                print(f"[AUTOMATION] Error: {e}")
            
            time.sleep(1)  # Run every second
    
    def _enforce_relay_states(self):
        """Periodically push all known relay states to callback.
        This ensures RELAY_STATES in api.py stays in sync even if
        a callback was missed during startup or race conditions."""
        now = time.time()
        if now - self._last_enforce < self._ENFORCE_INTERVAL:
            return
        self._last_enforce = now
        for name, relay in self.relays.items():
            if relay.state is not None:
                self.relay_callback(relay.relay_id, relay.state)
    
    def _process_automation(self):
        """Process all automation rules."""
        now = time.time()
        
        # Get filtered values
        temp = self.filters["temperature"].get()
        humidity = self.filters["humidity"].get()
        ph = self.filters["ph"].get()
        do = self.filters["do"].get()
        tds = self.filters["tds"].get()
        
        # Debug: log filter readiness once after override reset
        if any(r.state is None for r in self.relays.values()):
            ready_status = {k: (f.ready(), f.fast_ready() if hasattr(f, 'fast_ready') else 'N/A', len(f.values)) for k, f in self.filters.items()}
            print(f"[AUTOMATION DEBUG] Filter status: {ready_status}", flush=True)
            print(f"[AUTOMATION DEBUG] Values: temp={temp:.1f} hum={humidity:.1f} ph={ph:.2f} do={do:.2f} tds={tds:.0f}", flush=True)
        
        # Skip if filters not ready (not enough samples)
        filters_ready = all(f.ready() for f in self.filters.values())
        
        # ===== 1. MISTING PUMP (Relay 1) - 5s ON, 15min OFF =====
        self._process_misting(now)
        
        # ===== 2. AIR PUMP (Relay 2) - DO hysteresis =====
        # Use fast_ready (2 samples) because low DO is dangerous
        if self.filters["do"].fast_ready():
            if do < DO_LOW:
                self._set_relay("AIR_PUMP", True)
            elif do >= DO_HIGH:
                self._set_relay("AIR_PUMP", False)
        
        # ===== 3 & 4. EXHAUST IN/OUT (Relays 3 & 4) - Temp & Humidity =====
        # Only change exhaust state if we have valid sensor readings
        temp_ready = self.filters["temperature"].ready()
        humidity_ready = self.filters["humidity"].ready()
        
        if temp_ready or humidity_ready:
            # Start with current state (preserve if no clear decision, default False if unknown)
            exhaust_needed = bool(self.relays["EXHAUST_IN"].state)
            
            # Temperature-based control (only if temp filter ready)
            if temp_ready:
                if self._is_daytime():
                    # Daytime: 26°C ON, 23°C OFF
                    if temp > TEMP_DAY_HIGH:
                        exhaust_needed = True
                    elif temp <= TEMP_DAY_LOW:
                        exhaust_needed = False
                    # else: stay in current state (hysteresis band)
                else:
                    # Nighttime: 22°C ON, 19°C OFF
                    if temp > TEMP_NIGHT_HIGH:
                        exhaust_needed = True
                    elif temp <= TEMP_NIGHT_LOW:
                        exhaust_needed = False
                    # else: stay in current state (hysteresis band)
            
            # Humidity override (if humidity high, force exhaust ON regardless of temp)
            if humidity_ready:
                if humidity > HUMIDITY_HIGH:
                    exhaust_needed = True
                # Note: don't turn OFF based on humidity alone - let temp control that
            
            self._set_relay("EXHAUST_IN", exhaust_needed)
            self._set_relay("EXHAUST_OUT", exhaust_needed)
        
        # ===== 5 & 6. GROW LIGHTS (Relays 5 & 6) - Time-based =====
        lights_on = self._is_daytime()
        self._set_relay("GROW_LIGHTS_AERO", lights_on)
        self._set_relay("GROW_LIGHTS_DWC", lights_on)
        
        # ===== 7. pH UP (Relay 7) - Low pH =====
        if self.filters["ph"].ready():
            if ph < PH_LOW and now > self.ph_dosing_until:
                self._set_relay("PH_UP", True)
                self.ph_dosing_until = now + PH_DOSE_TIME
            elif self.relays["PH_UP"].state and now >= self.ph_dosing_until:
                # Dose finished — turn OFF and start cooldown
                self._set_relay("PH_UP", False)
                self.ph_dosing_until = now + PH_COOLDOWN
            elif not self.relays["PH_UP"].state and now >= self.ph_dosing_until:
                self._set_relay("PH_UP", False)
        
        # ===== 8. pH DOWN (Relay 8) - High pH =====
        if self.filters["ph"].ready():
            if ph > PH_HIGH and now > self.ph_dosing_until:
                self._set_relay("PH_DOWN", True)
                self.ph_dosing_until = now + PH_DOSE_TIME
            elif self.relays["PH_DOWN"].state and now >= self.ph_dosing_until:
                # Dose finished — turn OFF and start cooldown
                self._set_relay("PH_DOWN", False)
                self.ph_dosing_until = now + PH_COOLDOWN
            elif not self.relays["PH_DOWN"].state and now >= self.ph_dosing_until:
                self._set_relay("PH_DOWN", False)
        
        # ===== 9. LEAFY GREEN (Relay 9) - TDS dosing =====
        if self.filters["tds"].ready():
            self._process_tds_dosing(now, tds)
    
    def _process_misting(self, now: float):
        """Process misting pump cycle: 5s ON, 15min OFF."""
        relay = self.relays["MISTING"]
        
        # If state is unknown (None), initialize to OFF but keep existing timers
        # so the 15-min cycle resumes where it left off after override toggle
        if relay.state is None:
            self._set_relay("MISTING", False, force=True)
            return
        
        if relay.state:
            # Currently ON - check if time to turn OFF
            if now - self.misting_last_on >= MISTING_ON:
                self._set_relay("MISTING", False, force=True)
                self.misting_last_off = now
        else:
            # Currently OFF - check if time to turn ON
            if now - self.misting_last_off >= MISTING_OFF:
                self._set_relay("MISTING", True, force=True)
                self.misting_last_on = now
    
    def _process_tds_dosing(self, now: float, tds: float):
        """Process TDS-based nutrient dosing for leafy green."""
        relay = self.relays["LEAFY_GREEN"]
        
        # If state is unknown (None), initialize to OFF but keep existing timers
        if relay.state is None:
            self._set_relay("LEAFY_GREEN", False, force=True)
        
        # Check if dosing should be active
        if tds < TDS_LOW:
            self.tds_dosing_active = True
        elif tds >= TDS_HIGH:
            self.tds_dosing_active = False
            if relay.state:
                self._set_relay("LEAFY_GREEN", False, force=True)
            return
        
        if not self.tds_dosing_active:
            return
        
        # Pulse: 5s ON, 30s OFF
        if relay.state:
            # Currently ON - check if time to turn OFF
            if now - self.tds_dose_last_on >= TDS_DOSE_ON:
                self._set_relay("LEAFY_GREEN", False, force=True)
                self.tds_dose_last_off = now
        else:
            # Currently OFF - check if time to turn ON
            if now - self.tds_dose_last_off >= TDS_DOSE_OFF:
                self._set_relay("LEAFY_GREEN", True, force=True)
                self.tds_dose_last_on = now
    
    def get_status(self) -> Dict:
        """Get current automation status."""
        return {
            "enabled": self.enabled,
            "override_mode": self.override_mode,
            "is_daytime": self._is_daytime(),
            "filtered_values": {
                "temperature": round(self.filters["temperature"].get(), 2),
                "humidity": round(self.filters["humidity"].get(), 2),
                "ph": round(self.filters["ph"].get(), 2),
                "do": round(self.filters["do"].get(), 2),
                "tds": round(self.filters["tds"].get(), 2),
            },
            "relay_states": {
                name: relay.state for name, relay in self.relays.items()
            },
            "thresholds": {
                "do": {"low": DO_LOW, "high": DO_HIGH},
                "temp_day": {"high": TEMP_DAY_HIGH, "low": TEMP_DAY_LOW},
                "temp_night": {"high": TEMP_NIGHT_HIGH, "low": TEMP_NIGHT_LOW},
                "humidity": {"high": HUMIDITY_HIGH, "low": HUMIDITY_LOW},
                "ph": {"low": PH_LOW, "high": PH_HIGH},
                "tds": {"low": TDS_LOW, "high": TDS_HIGH},
            }
        }


# Global instance (initialized in api.py)
_controller: Optional[AutomationController] = None


def get_controller() -> Optional[AutomationController]:
    """Get the global automation controller instance."""
    return _controller


def init_controller(relay_callback: Callable[[int, bool], None]) -> AutomationController:
    """Initialize the global automation controller."""
    global _controller
    _controller = AutomationController(relay_callback)
    return _controller


if __name__ == "__main__":
    # Test the automation logic
    def test_callback(relay_id: int, state: bool):
        print(f"  [CALLBACK] Relay {relay_id} -> {'ON' if state else 'OFF'}")
    
    controller = AutomationController(test_callback)
    
    # Simulate sensor readings
    for i in range(20):
        controller.update_sensors({
            "temperature_c": 25 + (i % 5),
            "humidity": 65 + (i % 10),
            "ph": 6.5 + (i % 3) * 0.5,
            "do_mg_l": 7 + (i % 4),
            "tds_ppm": 650 + (i % 200),
        })
    
    print("\nStatus:", json.dumps(controller.get_status(), indent=2))
