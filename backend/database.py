import os
from datetime import datetime, timedelta

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

# -----------------------------------------------------------------------------
# Database Configuration
# -----------------------------------------------------------------------------

# Preferred: Use DATABASE_URL if it exists (recommended for cloud deployments)
DATABASE_URL = os.getenv("DATABASE_URL")

# Fallback to individual DB_* variables (useful for local development)
if not DATABASE_URL:
    DB_NAME = os.getenv("DB_NAME", "uno_db")
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "mattathil")
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "5433")

    DATABASE_URL = (
        f"postgresql://{DB_USER}:{DB_PASSWORD}"
        f"@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )

# Engine configuration
engine_kwargs = {
    "pool_pre_ping": True,
    "pool_recycle": 3600,
}

# Supabase / cloud PostgreSQL requires SSL
if (
    "supabase.co" in DATABASE_URL
    or "pooler.supabase.com" in DATABASE_URL
):
    engine_kwargs["connect_args"] = {
        "sslmode": "require"
    }

engine = create_engine(
    DATABASE_URL,
    **engine_kwargs,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


# -----------------------------------------------------------------------------
# Database Dependency
# -----------------------------------------------------------------------------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# -----------------------------------------------------------------------------
# Cleanup Helpers
# -----------------------------------------------------------------------------

ROOM_EXPIRY_HOURS = 2


def clean_old_rooms_helper(db: Session):
    """
    Cleanup expired database records safely.

    - Deletes expired OTP requests.
    - Deletes rooms older than ROOM_EXPIRY_HOURS.
    """

    try:
        from models import OTPRequest, Room

        now = datetime.utcnow()

        # Delete expired OTP requests
        db.query(OTPRequest).filter(
            OTPRequest.expires_at <= now
        ).delete(synchronize_session=False)

        # Delete expired rooms
        room_threshold = now - timedelta(hours=ROOM_EXPIRY_HOURS)

        db.query(Room).filter(
            Room.created_at <= room_threshold
        ).delete(synchronize_session=False)

        db.commit()

    except Exception as e:
        db.rollback()
        print("clean_old_rooms_helper exception handled:", e)
