import time
import logging
from datetime import datetime, timezone
from sensors import read_bme, read_analog
from db import init_db, get_session, SensorReading

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("collector")

SAMPLE_INTERVAL = 30  # seconds

def insert(session, sensor: str, value: float, unit: str = None, meta: dict = None):
    r = SensorReading(timestamp=datetime.now(timezone.utc), sensor=sensor, value=value, unit=unit, meta=meta)
    session.add(r)

def collect_once(session):
    b = read_bme()
    if b:
        insert(session, "temperature_c", b["temperature_c"], "C", {"source": "bme280"})
        insert(session, "humidity", b["humidity"], "%", {"source": "bme280"})
        insert(session, "pressure_hpa", b["pressure_hpa"], "hPa", {"source": "bme280"})
    a = read_analog()
    if a:  # Only insert analog data if available
        insert(session, "ph", a["ph"], "pH", {"voltage": a["ph_voltage"]})
        insert(session, "tds_ppm", a["tds_ppm"], "ppm", {"voltage": a["tds_voltage"]})
        insert(session, "do_mg_per_l", a["do_mg_per_l"], "mg/L", {"voltage": a["do_voltage"]})
    session.commit()

def main():
    init_db()
    session = get_session()
    logger.info("Starting collector, interval=%s seconds", SAMPLE_INTERVAL)
    from sync import sync_to_cloud
    try:
        while True:
            try:
                collect_once(session)
                logger.info("Collected and saved readings")
                sync_to_cloud()
            except Exception as e:
                logger.exception("Error during collection: %s", e)
            time.sleep(SAMPLE_INTERVAL)
    finally:
        session.close()

if __name__ == "__main__":
    main()
