import os
import random
import time
import uuid
import smtplib
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from database import get_db, clean_old_rooms_helper
from models import GuestUser, Room, RoomPlayer, OTPRequest
from schemas import (
    serialize_guest_user,
    serialize_room,
    get_avatar_url_helper,
    GuestUserResponse,
    RoomResponse
)
from auth import get_current_user, make_password, check_password
from websocket_manager import manager
from game.state_manager import GameStateManager, VersionMismatchError
from game import game_logic

app = FastAPI(title="UNO! Multiplayer API")

# Configure CORS to allow all origins as in settings.CORS_ALLOW_ALL_ORIGINS = True
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure Media folders exist
MEDIA_DIR = Path("media")
AVATARS_DIR = MEDIA_DIR / "avatars"
AVATARS_DIR.mkdir(parents=True, exist_ok=True)

# Mount media directory to serve uploads
app.mount("/media", StaticFiles(directory="media"), name="media")

# Helper to generate unique room code
def generate_room_code(db: Session) -> str:
    LETTERS = "ACDEFGHJKLMNPQRTUVWXY"
    DIGITS  = "2346789"
    ALL     = LETTERS + DIGITS
    while True:
        parts = (
            random.choices(LETTERS, k=2) +
            random.choices(DIGITS,  k=2) +
            random.choices(ALL,     k=2)
        )
        random.shuffle(parts)
        code = ''.join(parts)
        # Check uniqueness in DB
        exists = db.query(Room).filter(Room.code == code).first()
        if not exists:
            return code

def send_email_otp(to_email: str, code: str):
    host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
    port = int(os.getenv("EMAIL_PORT", 587))
    user = os.getenv("EMAIL_HOST_USER", "games.ambady.space@gmail.com")
    password = os.getenv("EMAIL_HOST_PASSWORD", "yjab dxle kzlf gyor")
    from_email = os.getenv("DEFAULT_FROM_EMAIL", '"UNO! Multiplayer" <games.ambady.space@gmail.com>')
    use_tls = os.getenv("EMAIL_USE_TLS", "True") == "True"

    # Plain text version
    text_message = (
        f"Hello,\n\n"
        f"Use the verification code below to log in or register your UNO! Multiplayer account:\n\n"
        f"{code}\n\n"
        f"This code will expire in 5 minutes. If you did not request this code, you can safely ignore this email.\n\n"
        f"Played with love by Ambady (https://ambady.space)\n"
        f"© 2026 UNO! Multiplayer. All rights reserved."
    )

    # HTML Version
    html_message = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Your UNO! Verification Code</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 20px; -webkit-font-smoothing: antialiased;">
        <div style="max-width: 500px; margin: 20px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); text-align: center;">
            <div style="margin-bottom: 24px;">
                <h1 style="color: #e11d48; font-size: 24px; font-weight: 800; letter-spacing: 0.5px; margin: 0; text-transform: uppercase;">UNO! MULTIPLAYER</h1>
            </div>
            <div style="line-height: 1.6; font-size: 15px; color: #334155; text-align: left;">
                <p style="margin: 0 0 16px 0;">Hello,</p>
                <p style="margin: 0 0 16px 0;">Use the verification code below to log in or register your <strong>UNO! Multiplayer</strong> account:</p>
                
                <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
                    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #0f172a; padding-left: 6px;">{code}</span>
                </div>
                
                <p style="margin: 0 0 16px 0; font-size: 14px; color: #64748b;">This code will expire in <strong>5 minutes</strong>. If you did not request this code, you can safely ignore this email.</p>
            </div>
            <div style="margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 11px; color: #94a3b8; text-align: center;">
                <p style="margin: 0 0 8px 0;">Played with ❤️ by <a href="https://ambady.space" target="_blank" style="color: #3b82f6; text-decoration: none; font-weight: 600;">Ambady</a></p>
                <p style="margin: 0;">&copy; 2026 UNO! Multiplayer. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """

    msg = MIMEMultipart('alternative')
    msg['Subject'] = "Your UNO! Verification Code"
    msg['From'] = from_email
    msg['To'] = to_email
    msg['Auto-Submitted'] = 'auto-generated'
    msg['X-Auto-Response-Suppress'] = 'All'

    msg.attach(MIMEText(text_message, 'plain'))
    msg.attach(MIMEText(html_message, 'html'))

    try:
        server = smtplib.SMTP(host, port)
        if use_tls:
            server.starttls()
        if user and password:
            server.login(user, password)
        server.sendmail(from_email, to_email, msg.as_string())
        server.quit()
    except Exception as e:
        raise RuntimeError(f"SMTP Error: {str(e)}")

# GET base URL helper
def get_base_url(request) -> str:
    # Formulates URL to dynamically match the scheme/host of the request
    return str(request.base_url)

# API Endpoints
from fastapi import Request

@app.post("/api/auth/guest/", response_model=GuestUserResponse, status_code=status.HTTP_201_CREATED)
def guest_register(request: Request, payload: dict, db: Session = Depends(get_db)):
    nickname = payload.get('nickname', '').strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="Nickname is required.")
    if len(nickname) > 50:
        raise HTTPException(status_code=400, detail="Nickname must be 50 characters or less.")
    
    user = GuestUser(nickname=nickname)
    db.add(user)
    db.commit()
    db.refresh(user)
    return serialize_guest_user(user, get_base_url(request))

@app.post("/api/auth/send-otp/")
def send_otp(payload: dict, db: Session = Depends(get_db)):
    clean_old_rooms_helper(db)
    email = payload.get('email', '').strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    
    code = f"{random.randint(100000, 999999)}"
    expires_at = datetime.utcnow() + timedelta(minutes=5)
    
    otp_req = OTPRequest(email=email, otp_code=code, expires_at=expires_at)
    db.add(otp_req)
    db.commit()
    
    try:
        send_email_otp(email, code)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")
        
    return {"message": "OTP sent successfully. Please check your email."}

@app.post("/api/auth/verify-otp/")
def verify_otp(request: Request, payload: dict, db: Session = Depends(get_db)):
    clean_old_rooms_helper(db)
    email = payload.get('email', '').strip().lower()
    code = payload.get('otp', '').strip()
    nickname = payload.get('nickname', '').strip() or email.split('@')[0]
    password = payload.get('password', '').strip()
    
    if not email or not code:
        raise HTTPException(status_code=400, detail="Email and OTP are required.")
        
    # Check OTP
    otp_reqs = db.query(OTPRequest).filter(
        OTPRequest.email == email,
        OTPRequest.otp_code == code,
        OTPRequest.expires_at > datetime.utcnow()
    ).order_by(OTPRequest.created_at.desc()).all()
    
    if not otp_reqs:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP.")
        
    # Retrieve or create GuestUser
    user = db.query(GuestUser).filter(GuestUser.email == email).first()
    created = False
    if not user:
        user = GuestUser(email=email)
        db.add(user)
        created = True
        
    user.is_registered = True
    if created or not user.nickname:
        user.nickname = nickname
    if password:
        user.password_hash = make_password(password)
        
    db.commit()
    db.refresh(user)
    
    # Clean up verified OTPs
    db.query(OTPRequest).filter(OTPRequest.email == email, OTPRequest.otp_code == code).delete()
    db.commit()
    
    return {
        "token": str(user.token),
        "user": serialize_guest_user(user, get_base_url(request)).dict()
    }

@app.post("/api/auth/login-password/")
def login_password(request: Request, payload: dict, db: Session = Depends(get_db)):
    email = payload.get('email', '').strip().lower()
    password = payload.get('password', '').strip()
    
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and Password are required.")
        
    user = db.query(GuestUser).filter(GuestUser.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account exists with this email. Please sign up first.")
        
    if not check_password(password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect password.")
        
    return {
        "token": str(user.token),
        "user": serialize_guest_user(user, get_base_url(request)).dict()
    }

@app.post("/api/auth/check-email/")
def check_email(payload: dict, db: Session = Depends(get_db)):
    email = payload.get('email', '').strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
        
    user = db.query(GuestUser).filter(GuestUser.email == email).first()
    if user:
        return {
            "exists": True,
            "has_password": bool(user.password_hash),
            "nickname": user.nickname
        }
    return {
        "exists": False,
        "has_password": False
    }

@app.get("/api/user/profile/", response_model=GuestUserResponse)
def user_profile_get(request: Request, user: GuestUser = Depends(get_current_user)):
    return serialize_guest_user(user, get_base_url(request))

@app.post("/api/user/profile/", response_model=GuestUserResponse)
async def user_profile_post(
    request: Request,
    nickname: Optional[str] = Form(None),
    avatar: Optional[UploadFile] = File(None),
    user: GuestUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if nickname:
        nickname = nickname.strip()
        if len(nickname) > 50:
            raise HTTPException(status_code=400, detail="Nickname must be 50 characters or less.")
        user.nickname = nickname
        
    if avatar:
        # Save file to media/avatars
        file_ext = avatar.filename.split('.')[-1]
        unique_filename = f"{uuid.uuid4()}.{file_ext}"
        file_path = AVATARS_DIR / unique_filename
        with open(file_path, "wb") as f:
            f.write(await avatar.read())
        user.avatar = f"avatars/{unique_filename}"
        
    db.commit()
    db.refresh(user)

    # Sync profile changes to active game lobbies in Redis
    try:
        state_manager = GameStateManager()
        active_memberships = db.query(RoomPlayer).filter(RoomPlayer.user_id == user.token).all()

        for membership in active_memberships:
            room_code = membership.room.code
            try:
                with state_manager.lock_room(room_code):
                    state = state_manager.get_state(room_code)
                    if state:
                        for p in state.get('players', []):
                            if p['id'] == str(user.token):
                                p['name'] = user.nickname
                                p['avatar_url'] = get_avatar_url_helper(user.avatar, get_base_url(request))
                                break
                        state_manager.save_state(room_code, state)
                # Trigger room state broadcast via connection manager
                await manager.broadcast_room_state(room_code, state)
            except Exception as e:
                print(f"Failed to sync profile update to Redis room {room_code}: {e}")
    except Exception as e:
        print(f"Failed to sync profile update: {e}")

    return serialize_guest_user(user, get_base_url(request))

@app.post("/api/rooms/", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
def room_create(request: Request, user: GuestUser = Depends(get_current_user), db: Session = Depends(get_db)):
    clean_old_rooms_helper(db)
    code = generate_room_code(db)
    room = Room(code=code, host_id=user.token, status='LOBBY')
    db.add(room)
    db.commit()
    db.refresh(room)
    
    player = RoomPlayer(room_id=room.id, user_id=user.token, slot_index=0)
    db.add(player)
    db.commit()
    db.refresh(room)
    
    return serialize_room(room, get_base_url(request))

@app.post("/api/rooms/{code}/join/", response_model=RoomResponse)
def room_join(request: Request, code: str, user: GuestUser = Depends(get_current_user), db: Session = Depends(get_db)):
    clean_old_rooms_helper(db)
    code = code.upper()
    room = db.query(Room).filter(Room.code == code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
        
    # Check if already in room
    player_exists = db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id, RoomPlayer.user_id == user.token).first()
    if player_exists:
        return serialize_room(room, get_base_url(request))
        
    if room.status != 'LOBBY':
        raise HTTPException(status_code=400, detail="Game has already started or finished.")
        
    current_players_count = db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id).count()
    if current_players_count >= 10:
        raise HTTPException(status_code=400, detail="Room is full (maximum 10 players).")
        
    # Add player
    player = RoomPlayer(room_id=room.id, user_id=user.token, slot_index=current_players_count)
    db.add(player)
    db.commit()
    db.refresh(room)
    
    return serialize_room(room, get_base_url(request))

@app.get("/api/rooms/{code}/", response_model=RoomResponse)
def room_detail(request: Request, code: str, user: GuestUser = Depends(get_current_user), db: Session = Depends(get_db)):
    clean_old_rooms_helper(db)
    code = code.upper()
    room = db.query(Room).filter(Room.code == code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    return serialize_room(room, get_base_url(request))


# WebSocket Connection Helper
def verify_websocket_membership_sync(db: Session, room_code: str, user_token: str) -> bool:
    room = db.query(Room).filter(Room.code == room_code).first()
    if not room:
        return False
    import uuid
    user_uuid = uuid.UUID(user_token)
    return db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id, RoomPlayer.user_id == user_uuid).first() is not None

def delete_room_player_sync(db: Session, room_code: str, host_token: str, target_token: str, is_leave: bool = False):
    room = db.query(Room).filter(Room.code == room_code).first()
    if not room:
        return
    import uuid
    host_uuid = uuid.UUID(host_token)
    target_uuid = uuid.UUID(target_token)
    if not is_leave and room.host_id != host_uuid:
        raise ValueError("Only the host can kick players.")
    if not is_leave and target_uuid == host_uuid:
        raise ValueError("You cannot kick yourself.")
        
    player = db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id, RoomPlayer.user_id == target_uuid).first()
    if player:
        db.delete(player)
        db.commit()
        
    if room.host_id == target_uuid:
        # Host left, delete all other players in this room to boot them
        db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id).delete()
        room.status = 'FINISHED'
        db.commit()

def finalize_game_in_db_sync(db: Session, room_code: str):
    room = db.query(Room).filter(Room.code == room_code).first()
    if room:
        room.status = 'FINISHED'
        db.commit()

def start_game_in_db_sync(db: Session, room_code: str, host_token: str) -> list:
    room = db.query(Room).filter(Room.code == room_code).first()
    if not room:
        raise ValueError("Room not found.")
    if str(room.host_id) != str(host_token):
        raise ValueError("Only the host can start the game.")
        
    db_players = db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id).order_by(RoomPlayer.slot_index).all()
    if len(db_players) < 2:
        raise ValueError("At least 2 players are required to start.")
        
    room.status = 'PLAYING'
    db.commit()
    return db_players

def reset_room_in_db_sync(db: Session, room_code: str, host_token: str) -> list:
    room = db.query(Room).filter(Room.code == room_code).first()
    if not room:
        raise ValueError("Room not found.")
    if str(room.host_id) != str(host_token):
        raise ValueError("Only the host can reset the room.")
    room.status = 'LOBBY'
    db.commit()
    return db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id).order_by(RoomPlayer.slot_index).all()


@app.websocket("/ws/room/{room_code}/")
@app.websocket("/ws/room/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, token: Optional[str] = None):
    # Verify auth
    if not token:
        await websocket.close(code=4001)
        return
        
    db = SessionLocal()
    try:
        import uuid
        try:
            token_uuid = uuid.UUID(token)
        except ValueError:
            await websocket.close(code=4001)
            return
        user = db.query(GuestUser).filter(GuestUser.token == token_uuid).first()
        if not user:
            await websocket.close(code=4001)
            return
            
        room_code = room_code.upper()
        # Verify player is associated with this room in DB
        is_member = verify_websocket_membership_sync(db, room_code, str(user.token))
        if not is_member:
            await websocket.close(code=4002)
            return
            
        # Connect to manager
        await manager.connect(room_code, str(user.token), websocket)
        
        state_manager = GameStateManager()
        
        # Helper function to initialize lobby state
        def initialize_lobby_state_sync():
            room = db.query(Room).filter(Room.code == room_code).first()
            db_players = db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id).order_by(RoomPlayer.slot_index).all()
            players_list = []
            for p in db_players:
                players_list.append({
                    'id': str(p.user.token),
                    'name': p.user.nickname,
                    'is_connected': True,
                    'called_uno': False,
                    'avatar_url': get_avatar_url_helper(p.user.avatar, str(websocket.base_url))
                })
            return {
                'room_code': room_code,
                'game_status': 'LOBBY',
                'version': 0,
                'players': players_list,
                'hands': {},
                'deck': [],
                'discard_pile': ['R_0'],
                'current_turn': 0,
                'direction': 1
            }

        # Update player connection status in Redis
        def update_connection_sync(is_connected):
            with state_manager.lock_room(room_code):
                state = state_manager.get_state(room_code)
                if not state:
                    state = initialize_lobby_state_sync()
                    
                if state.get('game_status') == 'LOBBY':
                    room = db.query(Room).filter(Room.code == room_code).first()
                    db_players = db.query(RoomPlayer).filter(RoomPlayer.room_id == room.id).order_by(RoomPlayer.slot_index).all()
                    state_player_ids = {p['id'] for p in state['players']}
                    for dp in db_players:
                        pid = str(dp.user.token)
                        if pid not in state_player_ids:
                            state['players'].append({
                                'id': pid,
                                'name': dp.user.nickname,
                                'is_connected': False,
                                'called_uno': False,
                                'avatar_url': get_avatar_url_helper(dp.user.avatar, str(websocket.base_url))
                            })
                            
                found = False
                for p in state['players']:
                    if p['id'] == str(user.token):
                        p['is_connected'] = is_connected
                        found = True
                        break
                        
                if not found and is_connected:
                    state['players'].append({
                        'id': str(user.token),
                        'name': user.nickname,
                        'is_connected': True,
                        'called_uno': False,
                        'avatar_url': get_avatar_url_helper(user.avatar, str(websocket.base_url))
                    })
                    
                state_manager.save_state(room_code, state)
                return state

        # Sync connection online
        state = update_connection_sync(is_connected=True)
        await manager.send_state_to_user(room_code, str(user.token), state)
        await manager.broadcast_room_state(room_code, state)

        # Listen loop
        try:
            while True:
                data = await websocket.receive_json()
                
                # Check and resolve turn timeout
                state, did_resolve = state_manager.check_and_resolve_timeout_for_room(room_code)
                if did_resolve:
                    await manager.broadcast_room_state(room_code, state)
                    
                action = data.get('type')
                event_id = data.get('event_id')
                client_version = data.get('client_version')
                
                if not action:
                    await websocket.send_json({"type": "error", "error_type": "invalid_payload", "message": "Action type is missing."})
                    continue
                    
                # Chat message
                if action == 'send_message':
                    message = data.get('data', {}).get('message', '').strip()
                    if message:
                        await manager.broadcast_to_room(room_code, {
                            "type": "chat_message",
                            "sender_id": str(user.token),
                            "sender_name": user.nickname,
                            "message": message,
                            "timestamp": time.time()
                        })
                    continue
                    
                # Idempotency
                if event_id and state_manager.is_event_processed(room_code, event_id):
                    print(f"Discarding duplicate event {event_id}")
                    continue
                    
                # Process Action
                try:
                    room_was_closed_by_host = False
                    
                    with state_manager.lock_room(room_code):
                        state = state_manager.get_state(room_code)
                        if not state:
                            state = initialize_lobby_state_sync()
                            
                        state_manager.verify_client_version(state, client_version)
                        
                        if action == 'start_game':
                            if state.get('game_status') == 'PLAYING':
                                raise ValueError("Game has already started.")
                            db_players = start_game_in_db_sync(db, room_code, str(user.token))
                            
                            # Check online status of everyone
                            for p in state.get('players', []):
                                if not p.get('is_connected', False):
                                    raise ValueError(f"Cannot start match. Player '{p['name']}' is offline.")
                                    
                            players_data = [
                                {
                                    "id": str(dp.user.token),
                                    "name": dp.user.nickname,
                                    "avatar_url": get_avatar_url_helper(dp.user.avatar, str(websocket.base_url))
                                } for dp in db_players
                            ]
                            
                            lobby_version = state.get('version', 0)
                            state = game_logic.initialize_game(players_data)
                            state['room_code'] = room_code
                            state['version'] = lobby_version
                            
                        elif action == 'play_card':
                            card = data.get('data', {}).get('card')
                            chosen_color = data.get('data', {}).get('chosen_color')
                            state = game_logic.handle_play_card(state, str(user.token), card, chosen_color)
                            
                        elif action == 'draw_card':
                            state = game_logic.handle_draw_card(state, str(user.token))
                            
                        elif action == 'pass_turn':
                            state = game_logic.handle_pass_turn(state, str(user.token))
                            
                        elif action == 'call_uno':
                            state = game_logic.handle_call_uno(state, str(user.token))
                            
                        elif action == 'call_out_uno':
                            target_id = data.get('data', {}).get('target_id')
                            state = game_logic.handle_call_out_uno(state, str(user.token), target_id)
                            
                        elif action == 'kick_player':
                            target_id = data.get('data', {}).get('target_id')
                            delete_room_player_sync(db, room_code, str(user.token), target_id)
                            state = state_manager.kick_player_from_state(room_code, target_id)
                            
                        elif action == 'leave_room':
                            room = db.query(Room).filter(Room.code == room_code).first()
                            if room and str(room.host_id) == str(user.token):
                                room_was_closed_by_host = True
                            delete_room_player_sync(db, room_code, str(user.token), str(user.token), is_leave=True)
                            state = state_manager.kick_player_from_state(room_code, str(user.token))
                            
                        elif action == 'reset_to_lobby':
                            if state.get('game_status') not in ('FINISHED', 'PLAYING'):
                                raise ValueError("Game is not finished yet.")
                            db_players = reset_room_in_db_sync(db, room_code, str(user.token))
                            players_list = []
                            for p in db_players:
                                players_list.append({
                                    'id': str(p.user.token),
                                    'name': p.user.nickname,
                                    'is_connected': True,
                                    'called_uno': False,
                                    'avatar_url': get_avatar_url_helper(p.user.avatar, str(websocket.base_url))
                                })
                            state = {
                                'room_code': room_code,
                                'game_status': 'LOBBY',
                                'version': state.get('version', 0),
                                'players': players_list,
                                'hands': {},
                                'deck': [],
                                'discard_pile': ['R_0'],
                                'current_turn': 0,
                                'direction': 1
                            }
                        else:
                            raise ValueError(f"Unknown action type: {action}")
                            
                        if state.get('game_status') == 'FINISHED' or room_was_closed_by_host:
                            finalize_game_in_db_sync(db, room_code)
                            
                        updated_state = state_manager.save_state(room_code, state)
                        if event_id:
                            state_manager.mark_event_processed(room_code, event_id)
                            
                    await manager.broadcast_room_state(room_code, updated_state)
                    
                    if action == 'kick_player':
                        target_id = data.get('data', {}).get('target_id')
                        await manager.broadcast_to_room(room_code, {
                            "type": "player_kicked",
                            "target_id": target_id,
                            "message": "You have been kicked by the host."
                        })
                    elif action == 'leave_room' and room_was_closed_by_host:
                        await manager.broadcast_to_room(room_code, {
                            "type": "room_closed",
                            "message": "The host has closed the room."
                        })
                        
                except VersionMismatchError as e:
                    await websocket.send_json({"type": "error", "error_type": "version_mismatch", "message": str(e)})
                    # Resend current state to sync client
                    curr_state = state_manager.get_state(room_code)
                    if curr_state:
                        await manager.send_state_to_user(room_code, str(user.token), curr_state)
                except (ValueError, AssertionError) as e:
                    await websocket.send_json({"type": "error", "error_type": "invalid_action", "message": str(e)})
                except Exception as e:
                    await websocket.send_json({"type": "error", "error_type": "server_error", "message": f"An unexpected error occurred: {str(e)}"})

        except WebSocketDisconnect:
            pass
        finally:
            # Sync connection offline
            manager.disconnect(room_code, str(user.token), websocket)
            state = update_connection_sync(is_connected=False)
            await manager.broadcast_room_state(room_code, state)

    finally:
        db.close()
