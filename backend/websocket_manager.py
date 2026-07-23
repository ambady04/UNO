from fastapi import WebSocket
from typing import Dict, List
import json

class ConnectionManager:
    def __init__(self):
        # Maps room_code -> user_id -> List of WebSockets
        self.active_connections: Dict[str, Dict[str, List[WebSocket]]] = {}

    async def connect(self, room_code: str, user_id: str, websocket: WebSocket):
        await websocket.accept()
        room_code = room_code.upper()
        if room_code not in self.active_connections:
            self.active_connections[room_code] = {}
        if user_id not in self.active_connections[room_code]:
            self.active_connections[room_code][user_id] = []
        self.active_connections[room_code][user_id].append(websocket)

    def disconnect(self, room_code: str, user_id: str, websocket: WebSocket):
        room_code = room_code.upper()
        if room_code in self.active_connections:
            if user_id in self.active_connections[room_code]:
                if websocket in self.active_connections[room_code][user_id]:
                    self.active_connections[room_code][user_id].remove(websocket)
                if not self.active_connections[room_code][user_id]:
                    del self.active_connections[room_code][user_id]
            if not self.active_connections[room_code]:
                del self.active_connections[room_code]

    async def send_state_to_user(self, room_code: str, user_id: str, state: dict):
        from game.state_manager import GameStateManager
        state_manager = GameStateManager()
        filtered = state_manager.filter_state_for_player(state, user_id)
        payload = {
            "type": "game_state_update",
            "version": state.get('version', 0),
            "state": filtered
        }
        
        room_code = room_code.upper()
        if room_code in self.active_connections:
            if user_id in self.active_connections[room_code]:
                for ws in self.active_connections[room_code][user_id]:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass

    async def broadcast_room_state(self, room_code: str, state: dict = None):
        from game.state_manager import GameStateManager
        state_manager = GameStateManager()
        room_code = room_code.upper()
        if not state:
            state = state_manager.get_state(room_code)
        if not state:
            return

        if room_code in self.active_connections:
            for user_id in list(self.active_connections[room_code].keys()):
                await self.send_state_to_user(room_code, user_id, state)

    async def broadcast_to_room(self, room_code: str, payload: dict):
        room_code = room_code.upper()
        if room_code in self.active_connections:
            for user_id, websockets in self.active_connections[room_code].items():
                for ws in websockets:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass

# Global connection manager instance
manager = ConnectionManager()
