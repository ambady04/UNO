import os
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv

load_dotenv()

# Build DB URL from environment variables
DB_NAME = os.getenv("DB_NAME", "uno_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "mattathil")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5433")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

ROOM_EXPIRY_HOURS = 2

def clean_old_rooms_helper(db: Session):
    """
    Cleanup expired database records.
    - Deletes expired OTP requests.
    - Deletes rooms older than ROOM_EXPIRY_HOURS.
    - RoomPlayer records are deleted automatically due to CASCADE.
    """
    from models import OTPRequest, Room
    now = datetime.utcnow()

    # Delete expired OTPs
    db.query(OTPRequest).filter(OTPRequest.expires_at <= now).delete()

    # Delete expired rooms
    room_threshold = now - timedelta(hours=ROOM_EXPIRY_HOURS)
    db.query(Room).filter(Room.created_at <= room_threshold).delete()
    
    db.commit()
