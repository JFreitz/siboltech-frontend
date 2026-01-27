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

def read_bme():
    """Return dict with temperature (C), humidity (%) and pressure (hPa).

    Returns empty dict if BME280 not available.
    """
    if not bme:
        return {}
    return {
        "temperature_c": round(bme.temperature, 3),
        "humidity": round(bme.relative_humidity, 3),
        "pressure_hpa": round(bme.pressure, 3),
    }

# --- Calibration functions moved to calibration.py ---

def read_analog():
    """Read analog channels and return raw voltages and converted values."""
    if not ads:
        # Mock data for testing without hardware
        return {
            "ph_voltage": 1.5,
            "ph": calibrate_ph(1.5),
            "tds_voltage": 1.0,
            "tds_ppm": calibrate_tds(1.0),
            "do_voltage": 2.0,
            "do_mg_per_l": calibrate_do(2.0),
        }
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
