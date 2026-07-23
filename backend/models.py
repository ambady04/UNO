import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Integer, BigInteger, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class GuestUser(Base):
    __tablename__ = "game_guestuser"

    token = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nickname = Column(String(50), nullable=False)
    email = Column(String(254), unique=True, nullable=True)
    is_registered = Column(Boolean, default=False, nullable=False)
    avatar = Column(String(100), nullable=True)
    password_hash = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    hosted_rooms = relationship("Room", back_populates="host", cascade="all, delete-orphan")
    players_relations = relationship("RoomPlayer", back_populates="user", cascade="all, delete-orphan")

    def __str__(self):
        return f"{self.nickname} ({str(self.token)[:8]})"


class OTPRequest(Base):
    __tablename__ = "game_otprequest"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(254), nullable=False)
    otp_code = Column(String(6), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)

    def __str__(self):
        return f"{self.email} - {self.otp_code}"


class Room(Base):
    __tablename__ = "game_room"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(6), unique=True, nullable=False)
    host_id = Column(UUID(as_uuid=True), ForeignKey("game_guestuser.token", ondelete="CASCADE"), nullable=False)
    status = Column(String(10), default="LOBBY", nullable=False)  # 'LOBBY', 'PLAYING', 'FINISHED'
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    host = relationship("GuestUser", back_populates="hosted_rooms")
    players_relations = relationship("RoomPlayer", back_populates="room", cascade="all, delete-orphan", order_by="RoomPlayer.slot_index")

    def __str__(self):
        return f"Room {self.code} ({self.status})"


class RoomPlayer(Base):
    __tablename__ = "game_roomplayer"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(Integer, ForeignKey("game_room.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("game_guestuser.token", ondelete="CASCADE"), nullable=False)
    slot_index = Column(Integer, default=0, nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    room = relationship("Room", back_populates="players_relations")
    user = relationship("GuestUser", back_populates="players_relations")

    __table_args__ = (
        UniqueConstraint("room_id", "user_id", name="game_roomplayer_room_id_user_id_uniq"),
    )

    def __str__(self):
        user_name = self.user.nickname if self.user else str(self.user_id)[:8]
        room_code = self.room.code if self.room else str(self.room_id)
        return f"{user_name} in {room_code}"

