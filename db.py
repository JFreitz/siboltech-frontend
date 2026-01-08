import os
from sqlalchemy import create_engine, Column, Integer, Float, Text, TIMESTAMP, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func

_DEFAULT_SQLITE_PATH = os.path.join(os.path.dirname(__file__), "sensors.db")
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_SQLITE_PATH}")
engine = create_engine(DB_URL, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

class SensorReading(Base):
    __tablename__ = "sensor_readings"
    id = Column(Integer, primary_key=True)
    timestamp = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    sensor = Column(Text, nullable=False)
    value = Column(Float)
    unit = Column(Text)
    meta = Column(JSON)

def init_db():
    Base.metadata.create_all(bind=engine)

def get_session():
    return SessionLocal()

if __name__ == "__main__":
    init_db()
    print("DB initialized ->", DB_URL)
