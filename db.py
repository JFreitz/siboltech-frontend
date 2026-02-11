import os
from sqlalchemy import create_engine, Column, Integer, Float, Text, TIMESTAMP, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func

_DEFAULT_SQLITE_PATH = os.path.join(os.path.dirname(__file__), "sensors.db")
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_SQLITE_PATH}")

_connect_args = {}
if DB_URL.startswith("sqlite"):
    _connect_args["timeout"] = 10  # Wait up to 10s for locks instead of failing immediately

engine = create_engine(DB_URL, echo=False, future=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# Enable WAL mode for SQLite (allows concurrent reads + writes)
if DB_URL.startswith("sqlite"):
    from sqlalchemy import event
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.close()
Base = declarative_base()

class SensorReading(Base):
    __tablename__ = "sensor_readings"
    id = Column(Integer, primary_key=True)
    timestamp = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    sensor = Column(Text, nullable=False)
    value = Column(Float)
    unit = Column(Text)
    meta = Column(JSON)

class PlantReading(Base):
    __tablename__ = "plant_readings"
    id = Column(Integer, primary_key=True)
    timestamp = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    plant_id = Column(Integer, nullable=False)  # Plant 1-6
    farming_system = Column(Text, nullable=False)  # 'aeroponics', 'dwc', 'traditional'
    leaves = Column(Float)
    branches = Column(Float)
    height = Column(Float)
    weight = Column(Float)
    length = Column(Float)

class ActuatorEvent(Base):
    __tablename__ = "actuator_events"
    id = Column(Integer, primary_key=True)
    timestamp = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    relay_id = Column(Integer, nullable=False)  # 1-9
    state = Column(Integer, nullable=False)  # 0 = OFF, 1 = ON
    meta = Column(JSON)  # Extra info like triggering condition

def init_db():
    Base.metadata.create_all(bind=engine)

def get_session():
    return SessionLocal()

if __name__ == "__main__":
    init_db()
    print("DB initialized ->", DB_URL)
