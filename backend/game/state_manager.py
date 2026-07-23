import redis
import json
import time
from contextlib import contextmanager
from .game_logic import check_deck_integrity, resolve_turn_timeout

import os

# Connect to Redis using environment variables
redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
redis_client = redis.Redis.from_url(redis_url, decode_responses=True, protocol=2)

class VersionMismatchError(ValueError):
    pass

class GameStateManager:
    def __init__(self, r_client=redis_client):
        self.r = r_client

    def get_game_key(self, room_code):
        return f"game:{room_code}"

    def get_lock_key(self, room_code):
        return f"lock:game:{room_code}"

    def get_processed_event_key(self, room_code, event_id):
        return f"processed:{room_code}:{event_id}"

    @contextmanager
    def lock_room(self, room_code, timeout=5):
        """
        Acquires a Redis distributed lock for a minimal critical section.
        Ensures safe release in try/finally block.
        """
        lock_key = self.get_lock_key(room_code)
        lock = self.r.lock(lock_key, timeout=timeout, sleep=0.1)
        acquired = lock.acquire(blocking=True, blocking_timeout=timeout)
        if not acquired:
            raise TimeoutError("Could not acquire room lock. Please try again.")
        try:
            yield
        finally:
            # Safely release lock
            try:
                lock.release()
            except Exception:
                pass # Lock might have already expired or been released

    def is_event_processed(self, room_code, event_id):
        """
        Checks if an event_id has already been processed (event idempotency).
        """
        if not event_id:
            return False
        key = self.get_processed_event_key(room_code, event_id)
        return self.r.exists(key) == 1

    def mark_event_processed(self, room_code, event_id, expiry=86400):
        """
        Marks an event_id as processed to enforce idempotency.
        """
        if not event_id:
            return
        key = self.get_processed_event_key(room_code, event_id)
        self.r.set(key, "1", ex=expiry)

    def get_state(self, room_code):
        """
        Gets the JSON serialized game state from Redis.
        """
        key = self.get_game_key(room_code)
        data = self.r.get(key)
        if not data:
            return None
        return json.loads(data)

    def save_state(self, room_code, state):
        """
        Saves the game state after validating and incrementing the version.
        """
        # Enforce validations
        self.validate_state_integrity(state)
        
        # Increment version
        state['version'] = state.get('version', 0) + 1
        
        # Save to Redis
        key = self.get_game_key(room_code)
        self.r.set(key, json.dumps(state))
        return state

    def validate_state_integrity(self, state):
        """
        Enforces:
        - 108 cards total integrity
        - valid current_turn bounds
        - non-empty discard pile
        """
        if state.get('game_status') == 'LOBBY':
            return

        # 1. 108 cards integrity (asserts inside game_logic)
        check_deck_integrity(state)
        
        # 2. current_turn valid bounds
        num_players = len(state['players'])
        current_turn = state.get('current_turn', 0)
        if not (0 <= current_turn < num_players):
            raise AssertionError(f"Invalid current_turn: {current_turn} (players count: {num_players})")
            
        # 3. non-empty discard pile
        discard = state.get('discard_pile', [])
        if len(discard) == 0:
            raise AssertionError("Discard pile cannot be empty.")

    def verify_client_version(self, state, client_version):
        """
        Verifies that the client is acting on the latest server state version.
        """
        server_version = state.get('version', 1)
        if client_version is not None and client_version != server_version:
            raise VersionMismatchError(
                f"Client version mismatch: client={client_version}, server={server_version}"
            )

    def filter_state_for_player(self, state, player_id):
        """
        Builds a player-specific state response:
        - Shows full cards in hands only for player_id.
        - Other players show only their card count (len of hand).
        - Deck list is replaced by its card count.
        """
        filtered_hands = {}
        for pid, hand in state['hands'].items():
            if pid == player_id:
                filtered_hands[pid] = hand
            else:
                filtered_hands[pid] = len(hand)

        # Build players list with counts for the client
        filtered_players = []
        for p in state['players']:
            pid = p['id']
            hand_len = len(state['hands'].get(pid, []))
            filtered_players.append({
                'id': pid,
                'name': p['name'],
                'is_connected': p['is_connected'],
                'called_uno': p['called_uno'],
                'card_count': hand_len,
                'avatar_url': p.get('avatar_url')
            })

        return {
            'room_code': state.get('room_code'),
            'game_status': state.get('game_status'),
            'version': state.get('version'),
            'current_turn': state.get('current_turn'),
            'direction': state.get('direction'),
            'discard_pile': [state['discard_pile'][-1]] if state['discard_pile'] else [],
            'current_color': state.get('current_color'),
            'current_value': state.get('current_value'),
            'turn_started_at': state.get('turn_started_at'),
            'has_drawn_this_turn': state.get('has_drawn_this_turn', False),
            'draw_penalty': state.get('draw_penalty', 0),
            'winner_id': state.get('winner_id'),
            'winner_name': state.get('winner_name'),
            'deck_count': len(state['deck']),
            'players': filtered_players,
            'hand': state['hands'].get(player_id, [])
        }

    def kick_player_from_state(self, room_code, target_id):
        """
        Permanently removes a player from the game state in Redis.
        Returns the updated state.
        """
        import random
        state = self.get_state(room_code)
        if not state:
            return None

        # Find target player index
        kicked_idx = -1
        for idx, p in enumerate(state.get('players', [])):
            if p['id'] == target_id:
                kicked_idx = idx
                break

        if kicked_idx == -1:
            return state

        # Shuffle their hand back to the deck (if playing)
        hand = state.get('hands', {}).get(target_id, [])
        if hand:
            state.setdefault('deck', []).extend(hand)
            random.shuffle(state['deck'])

        # Remove hand from state
        if 'hands' in state and target_id in state['hands']:
            del state['hands'][target_id]

        status = state.get('game_status', 'LOBBY')
        if status == 'PLAYING':
            N = len(state['players'])
            current_turn = state.get('current_turn', 0)
            
            if current_turn == kicked_idx:
                # Active player is kicked
                if N > 1:
                    direction = state.get('direction', 1)
                    if direction == 1:
                        state['current_turn'] = kicked_idx % (N - 1)
                    else:
                        state['current_turn'] = (kicked_idx - 1) % (N - 1)
                else:
                    state['current_turn'] = 0
            else:
                # Non-active player is kicked
                if kicked_idx < current_turn:
                    state['current_turn'] = current_turn - 1

            # Keep current_turn within bounds just in case
            if N - 1 > 0:
                state['current_turn'] = state['current_turn'] % (N - 1)
            else:
                state['current_turn'] = 0

            # Reset turn timer since turn shifted or layout changed
            state['turn_started_at'] = time.time()
            # Reset drawing flag
            state['has_drawn_this_turn'] = False

        # Remove from players list
        state['players'].pop(kicked_idx)

        # Check if match ended due to too few players
        if status == 'PLAYING' and len(state['players']) < 2:
            state['game_status'] = 'FINISHED'

        return state

    def check_and_resolve_timeout_for_room(self, room_code):
        """
        Checks if the active player's turn has expired, and if so, applies auto-draw and pass.
        Returns (updated_state, did_resolve)
        """
        with self.lock_room(room_code):
            state = self.get_state(room_code)
            if not state:
                return None, False
                
            did_resolve = resolve_turn_timeout(state)
            if did_resolve:
                # Save updated state
                state = self.save_state(room_code, state)
            return state, did_resolve
