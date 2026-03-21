import time
from calibration import calibrate_ph, calibrate_tds, calibrate_do

# Try to import hardware libraries (RPi-specific)
try:
    import board
    import busio
    from adafruit_bme280 import basic as adafruit_bme280
    import adafruit_ads1x15.ads1115 as ADS
    from adafruit_ads1x15.analog_in import AnalogIn
    
    # Initialize I2C
    _i2c = busio.I2C(board.SCL, board.SDA)
    
    # BME280 (temp, humidity, pressure)
    try:
        bme = adafruit_bme280.Adafruit_BME280_I2C(_i2c)
    except Exception:
        bme = None
    
    # ADS1115 (ADC for pH/TDS/DO probes)
    try:
        ads = ADS.ADS1115(_i2c)
        chan_ph = AnalogIn(ads, ADS.P0)
        chan_tds = AnalogIn(ads, ADS.P1)
        chan_do = AnalogIn(ads, ADS.P2)
    except Exception:
        ads = None
        chan_ph = chan_tds = chan_do = None
except Exception as e:
    # Fallback for non-RPi (desktop development)
    # print(f"[WARNING] Hardware libraries unavailable ({e}), using mock mode")
    bme = None
    ads = None
    chan_ph = chan_tds = chan_do = None

import math

# BME280 valid ranges (datasheet)
_BME_TEMP_MIN, _BME_TEMP_MAX = -40.0, 85.0
_BME_HUM_MIN, _BME_HUM_MAX = 0.0, 100.0
_BME_PRESS_MIN, _BME_PRESS_MAX = 300.0, 1100.0

_last_good_bme = {}

def read_bme():
    """Return dict with temperature (C), humidity (%) and pressure (hPa).

    Returns empty dict if BME280 not available.
    Validates readings against BME280 datasheet ranges.
    Falls back to last known good values on bad reads.
    """
    global _last_good_bme
    if not bme:
        return {}

    t = bme.temperature
    h = bme.relative_humidity
    p = bme.pressure

    result = {}

    # Validate temperature
    if not (math.isnan(t) or math.isinf(t)) and _BME_TEMP_MIN <= t <= _BME_TEMP_MAX:
        result["temperature_c"] = round(t, 3)
        _last_good_bme["temperature_c"] = result["temperature_c"]
    elif "temperature_c" in _last_good_bme:
        result["temperature_c"] = _last_good_bme["temperature_c"]
    else:
        return {}  # No valid temp ever, skip entire reading

    # Validate humidity
    if not (math.isnan(h) or math.isinf(h)) and _BME_HUM_MIN <= h <= _BME_HUM_MAX:
        result["humidity"] = round(h, 3)
        _last_good_bme["humidity"] = result["humidity"]
    elif "humidity" in _last_good_bme:
        result["humidity"] = _last_good_bme["humidity"]

    # Validate pressure
    if not (math.isnan(p) or math.isinf(p)) and _BME_PRESS_MIN <= p <= _BME_PRESS_MAX:
        result["pressure_hpa"] = round(p, 3)
        _last_good_bme["pressure_hpa"] = result["pressure_hpa"]
    elif "pressure_hpa" in _last_good_bme:
        result["pressure_hpa"] = _last_good_bme["pressure_hpa"]

    return result

# --- Calibration functions moved to calibration.py ---

def read_analog():
    """Read analog channels and return raw voltages and converted values."""
    if not ads:
        # No mock data - return empty dict when ADS1115 not available
        return {}
    v_ph = chan_ph.voltage
    v_tds = chan_tds.voltage
    v_do = chan_do.voltage
    return {
        "ph_voltage": round(v_ph, 4),
        "ph": calibrate_ph(v_ph),
        "tds_voltage": round(v_tds, 4),
        "tds_ppm": calibrate_tds(v_tds),
        "do_voltage": round(v_do, 4),
        "do_mg_per_l": calibrate_do(v_do),
    }

if __name__ == "__main__":
    print("BME280:", read_bme())
    print("Analog:", read_analog())
