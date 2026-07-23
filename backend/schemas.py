from pydantic import BaseModel, UUID4
from datetime import datetime
from typing import List, Optional

class GuestUserResponse(BaseModel):
    token: UUID4
    nickname: str
    email: Optional[str] = None
    is_registered: bool
    avatar: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class RoomPlayerResponse(BaseModel):
    user_id: UUID4
    nickname: str
    slot_index: int
    avatar_url: Optional[str] = None


class RoomResponse(BaseModel):
    code: str
    status: str
    host_id: UUID4
    host_nickname: str
    players: List[RoomPlayerResponse]
    created_at: datetime

    class Config:
        from_attributes = True


def get_avatar_url_helper(avatar_path: Optional[str], base_url: str) -> Optional[str]:
    if not avatar_path:
        return None
    if avatar_path.startswith("http://") or avatar_path.startswith("https://"):
        return avatar_path
    # Avatar path can be e.g. "avatars/my_image.png"
    # Ensure it's not double prefixed
    clean_path = avatar_path.lstrip("/")
    if not clean_path.startswith("media/"):
        clean_path = f"media/{clean_path}"
    return f"{base_url.rstrip('/')}/{clean_path}"


def serialize_guest_user(user, base_url: str) -> GuestUserResponse:
    avatar_url = get_avatar_url_helper(user.avatar, base_url)
    return GuestUserResponse(
        token=user.token,
        nickname=user.nickname,
        email=user.email,
        is_registered=user.is_registered,
        avatar=user.avatar,
        avatar_url=avatar_url,
        created_at=user.created_at
    )


def serialize_room(room, base_url: str) -> RoomResponse:
    players = []
    for rp in room.players_relations:
        players.append(RoomPlayerResponse(
            user_id=rp.user.token,
            nickname=rp.user.nickname,
            slot_index=rp.slot_index,
            avatar_url=get_avatar_url_helper(rp.user.avatar, base_url)
        ))
    
    return RoomResponse(
        code=room.code,
        status=room.status,
        host_id=room.host.token,
        host_nickname=room.host.nickname,
        players=players,
        created_at=room.created_at
    )
