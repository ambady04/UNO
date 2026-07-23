import hashlib
import secrets
import base64
from fastapi import Header, HTTPException, Depends, status
from sqlalchemy.orm import Session
from database import get_db
from models import GuestUser

def get_pbkdf2_hash(password: str, salt: str, iterations: int) -> str:
    hash_bytes = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        iterations
    )
    return base64.b64encode(hash_bytes).decode('ascii').strip()

def make_password(password: str, iterations: int = 600000) -> str:
    salt = secrets.token_hex(16)
    hash_val = get_pbkdf2_hash(password, salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt}${hash_val}"

def check_password(password: str, encoded: str) -> bool:
    if not encoded or not password:
        return False
    parts = encoded.split('$')
    if len(parts) != 4 or parts[0] != 'pbkdf2_sha256':
        return False
    _, iterations_str, salt, hash_val = parts
    try:
        iterations = int(iterations_str)
    except ValueError:
        return False
    
    calculated_hash = get_pbkdf2_hash(password, salt, iterations)
    return secrets.compare_digest(calculated_hash, hash_val)

def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> GuestUser:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header is missing."
        )
    
    parts = authorization.split()
    if len(parts) != 2:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header format must be: Token <token> or Bearer <token>"
        )
    
    auth_type, token_str = parts
    if auth_type.lower() not in ('token', 'bearer'):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization scheme must be Token or Bearer."
        )
        
    try:
        import uuid
        token_uuid = uuid.UUID(token_str)
        user = db.query(GuestUser).filter(GuestUser.token == token_uuid).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token."
            )
        return user
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token format."
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication error: {str(e)}"
        )
