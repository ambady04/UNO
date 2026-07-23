import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from main import app
from database import get_db
from models import Base, GuestUser, Room, RoomPlayer

# SQLite in-memory database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"  # Use file-based SQLite for simpler testing compatibility
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Recreate tables
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

def test_guest_registration_success():
    response = client.post("/api/auth/guest/", json={"nickname": "Alice"})
    assert response.status_code == 201
    data = response.json()
    assert "token" in data
    assert data["nickname"] == "Alice"

def test_guest_registration_empty_nickname():
    response = client.post("/api/auth/guest/", json={"nickname": ""})
    assert response.status_code == 400

def test_create_room_success():
    # 1. Register guest
    reg_resp = client.post("/api/auth/guest/", json={"nickname": "HostAlice"})
    token = reg_resp.json()["token"]

    # 2. Create room
    headers = {"Authorization": f"Token {token}"}
    response = client.post("/api/rooms/", headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert "code" in data
    assert data["status"] == "LOBBY"
    assert data["host_nickname"] == "HostAlice"

def test_join_room_success():
    # 1. Register host
    reg_alice = client.post("/api/auth/guest/", json={"nickname": "Alice"})
    alice_token = reg_alice.json()["token"]

    # 2. Create room
    headers_alice = {"Authorization": f"Token {alice_token}"}
    room_resp = client.post("/api/rooms/", headers=headers_alice)
    room_code = room_resp.json()["code"]

    # 3. Register joiner
    reg_bob = client.post("/api/auth/guest/", json={"nickname": "Bob"})
    bob_token = reg_bob.json()["token"]

    # 4. Join room
    headers_bob = {"Authorization": f"Token {bob_token}"}
    join_resp = client.post(f"/api/rooms/{room_code}/join/", headers=headers_bob)
    assert join_resp.status_code == 200
    data = join_resp.json()
    assert len(data["players"]) == 2
    assert data["players"][1]["nickname"] == "Bob"

# Clean up SQLite test file afterwards
import os
@pytest.fixture(scope="session", autouse=True)
def cleanup(request):
    def remove_test_db():
        engine.dispose()
        if os.path.exists("./test.db"):
            os.remove("./test.db")
    request.addfinalizer(remove_test_db)
