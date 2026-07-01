import json
import time
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from .models import Room, RoomPlayer, GuestUser
from .state_manager import GameStateManager, VersionMismatchError
from . import game_logic

class UnoConsumer(AsyncJsonWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.state_manager = GameStateManager()
        self.room_code = None
        self.room_group_name = None
        self.user = None

    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or self.user.is_anonymous:
            await self.close(code=4001) # Authentication failure
            return

        self.room_code = self.scope['url_route']['kwargs']['room_code'].upper()
        self.room_group_name = f"room_{self.room_code}"

        # Verify player is associated with this room in Postgres
        is_member = await self.verify_room_membership()
        if not is_member:
            await self.close(code=4002) # Unauthorized room access
            return

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

        # Update player connection status in Redis
        await self.update_player_connection_status(is_connected=True)

        # Send state directly to this newly connected client (avoids race with group_send)
        await self.send_single_client_state()

        # Broadcast updated player list to all OTHER players already in the room
        await self.broadcast_room_state()

    async def disconnect(self, close_code):
        if self.room_group_name:
            # Update player connection status to offline
            await self.update_player_connection_status(is_connected=False)

            # Broadcast state update to others in the room
            await self.broadcast_room_state()

            # Leave room group
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive_json(self, content):
        # 1. Resolve turn timeout on every incoming event
        await self.check_and_resolve_timeout()

        action = content.get('type')
        event_id = content.get('event_id')
        client_version = content.get('client_version')

        if not action:
            await self.send_error("invalid_payload", "Action type is missing.")
            return

        # Handle Chat separate from game state locks
        if action == 'send_message':
            message = content.get('data', {}).get('message', '').strip()
            if message:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        "type": "chat_message",
                        "sender_id": str(self.user.token),
                        "sender_name": self.user.nickname,
                        "message": message,
                        "timestamp": time.time()
                    }
                )
            return

        # 2. Reject duplicate events (idempotency)
        if event_id:
            already_processed = await database_sync_to_async(self.state_manager.is_event_processed)(self.room_code, event_id)
            if already_processed:
                print(f"Discarding duplicate event {event_id}")
                return

        # 3. Process Game State updates inside Redis Lock
        try:
            await self.process_game_action(action, content.get('data', {}), client_version, event_id)
        except VersionMismatchError as e:
            # Send latest state to client to refresh
            await self.send_error("version_mismatch", str(e))
            await self.send_single_client_state()
        except (ValueError, AssertionError) as e:
            await self.send_error("invalid_action", str(e))
        except Exception as e:
            await self.send_error("server_error", f"An unexpected error occurred: {str(e)}")

    async def process_game_action(self, action, data, client_version, event_id):
        # We wrapper the synchronous operations inside lock_room
        room_was_closed_by_host = False

        def run_locked():
            nonlocal room_was_closed_by_host
            with self.state_manager.lock_room(self.room_code):
                state = self.state_manager.get_state(self.room_code)
                if not state:
                    # If game hasn't started yet, we are in LOBBY state
                    state = self.initialize_lobby_state()

                # Verify version (ignore if client_version is not supplied, but it's mandatory here)
                self.state_manager.verify_client_version(state, client_version)

                # Process specific actions
                if action == 'start_game':
                    state = self.action_start_game(state)
                elif action == 'play_card':
                    card = data.get('card')
                    chosen_color = data.get('chosen_color')
                    state = game_logic.handle_play_card(state, str(self.user.token), card, chosen_color)
                elif action == 'draw_card':
                    state = game_logic.handle_draw_card(state, str(self.user.token))
                elif action == 'pass_turn':
                    state = game_logic.handle_pass_turn(state, str(self.user.token))
                elif action == 'call_uno':
                    state = game_logic.handle_call_uno(state, str(self.user.token))
                elif action == 'call_out_uno':
                    target_id = data.get('target_id')
                    state = game_logic.handle_call_out_uno(state, str(self.user.token), target_id)
                elif action == 'kick_player':
                    target_id = data.get('target_id')
                    self.delete_room_player_sync(target_id)
                    state = self.state_manager.kick_player_from_state(self.room_code, target_id)
                elif action == 'leave_room':
                    # Check if the person leaving is the host
                    try:
                        room = Room.objects.get(code=self.room_code)
                        if str(room.host_id) == str(self.user.token):
                            room_was_closed_by_host = True
                    except Room.DoesNotExist:
                        pass
                    # Allow player to leave room database association
                    self.delete_room_player_sync(str(self.user.token), is_leave=True)
                    state = self.state_manager.kick_player_from_state(self.room_code, str(self.user.token))
                elif action == 'reset_to_lobby':
                    state = self.action_reset_to_lobby(state)
                else:
                    raise ValueError(f"Unknown action type: {action}")

                # If status became FINISHED, update database
                if state.get('game_status') == 'FINISHED' or room_was_closed_by_host:
                    self.finalize_game_in_db_sync(state)

                # Save state (increments version and validates)
                updated_state = self.state_manager.save_state(self.room_code, state)
                
                # Mark event as processed
                if event_id:
                    self.state_manager.mark_event_processed(self.room_code, event_id)

                return updated_state

        await database_sync_to_async(run_locked)()
        
        # Broadcast updated state
        await self.broadcast_room_state()

        # If kicked, also broadcast the eviction notification
        if action == 'kick_player':
            target_id = data.get('target_id')
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "player_kicked_broadcast",
                    "target_id": target_id,
                    "message": "You have been kicked by the host."
                }
            )
        elif action == 'leave_room' and room_was_closed_by_host:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "room_closed_broadcast",
                    "message": "The host has closed the room."
                }
            )

    def action_start_game(self, state):
        if state.get('game_status') == 'PLAYING':
            raise ValueError("Game has already started.")

        # Verify host
        room = Room.objects.get(code=self.room_code)
        if str(room.host_id) != str(self.user.token):
            raise ValueError("Only the host can start the game.")

        # Get list of players associated in DB
        db_players = RoomPlayer.objects.filter(room=room).order_by('slot_index')
        if db_players.count() < 2:
            raise ValueError("At least 2 players are required to start.")

        # Ensure all teammates in state are online/connected
        for p in state.get('players', []):
            if not p.get('is_connected', False):
                raise ValueError(f"Cannot start match. Player '{p['name']}' is offline.")

        players_data = [
            {
                "id": str(p.user.token),
                "name": p.user.nickname,
                "avatar_url": p.user.avatar.url if p.user.avatar else None
            } for p in db_players
        ]
        
        # Initialize game state
        lobby_version = state.get('version', 0)
        state = game_logic.initialize_game(players_data)
        state['room_code'] = self.room_code
        state['version'] = lobby_version

        # Update Room status to PLAYING in PostgreSQL
        room.status = 'PLAYING'
        room.save()

        return state

    def action_reset_to_lobby(self, state):
        """Resets a FINISHED game back to LOBBY so players can play again."""
        # Only allow from FINISHED state
        if state.get('game_status') not in ('FINISHED', 'PLAYING'):
            raise ValueError("Game is not finished yet.")

        # Verify host
        room = Room.objects.get(code=self.room_code)
        if str(room.host_id) != str(self.user.token):
            raise ValueError("Only the host can reset the room.")

        # Rebuild fresh lobby state from DB players
        db_players = RoomPlayer.objects.filter(room=room).order_by('slot_index')
        players_list = []
        for p in db_players:
            players_list.append({
                'id': str(p.user.token),
                'name': p.user.nickname,
                'is_connected': True,
                'called_uno': False,
                'avatar_url': p.user.avatar.url if p.user.avatar else None
            })

        # Reset Room status in PostgreSQL
        room.status = 'LOBBY'
        room.save()

        return {
            'room_code': self.room_code,
            'game_status': 'LOBBY',
            'version': state.get('version', 0),  # save_state will increment this
            'players': players_list,
            'hands': {},
            'deck': [],
            'discard_pile': ['R_0'],
            'current_turn': 0,
            'direction': 1
        }

    def finalize_game_in_db_sync(self, state):
        try:
            room = Room.objects.get(code=self.room_code)
            room.status = 'FINISHED'
            room.save()

            # Identify winner
            winner_id = None
            winner_name = "Unknown"
            
            # Winner is the player with 0 cards in hand
            for pid, hand in state['hands'].items():
                if len(hand) == 0:
                    winner_id = pid
                    break

        except Exception as e:
            print("Error finalizing game in db:", e)


    def delete_room_player_sync(self, target_id, is_leave=False):
        room = Room.objects.get(code=self.room_code)
        if not is_leave and str(room.host_id) != str(self.user.token):
            raise ValueError("Only the host can kick players.")

        if not is_leave and target_id == str(self.user.token):
            raise ValueError("You cannot kick yourself.")

        try:
            player = RoomPlayer.objects.get(room=room, user__token=target_id)
            player.delete()
        except RoomPlayer.DoesNotExist:
            pass

        # Handle host rotation or closure if the leaving player was the host
        if str(room.host_id) == str(target_id):
            # Delete all other players in this room to boot them
            RoomPlayer.objects.filter(room=room).delete()
            room.status = 'FINISHED'
            room.save()

    def initialize_lobby_state(self):
        """
        Creates a basic state representing the room lobby before game starts.
        """
        room = Room.objects.get(code=self.room_code)
        db_players = RoomPlayer.objects.filter(room=room).order_by('slot_index')
        players_list = []
        for p in db_players:
            players_list.append({
                'id': str(p.user.token),
                'name': p.user.nickname,
                'is_connected': True,
                'called_uno': False,
                'avatar_url': p.user.avatar.url if p.user.avatar else None
            })

        return {
            'room_code': self.room_code,
            'game_status': 'LOBBY',
            'version': 0,
            'players': players_list,
            'hands': {},
            'deck': [],
            'discard_pile': ['R_0'], # Mock card to pass validator check in lobby state
            'current_turn': 0,
            'direction': 1
        }

    async def check_and_resolve_timeout(self):
        """
        Runs the timeout check in Redis. If expired, updates state and triggers broadcast.
        """
        state, did_resolve = await database_sync_to_async(
            self.state_manager.check_and_resolve_timeout_for_room
        )(self.room_code)

        if did_resolve:
            # Broadcast state
            await self.broadcast_room_state()

    async def update_player_connection_status(self, is_connected):
        def update_connection_sync():
            with self.state_manager.lock_room(self.room_code):
                state = self.state_manager.get_state(self.room_code)
                if not state:
                    state = self.initialize_lobby_state()

                # In LOBBY state: sync Redis player list with the database.
                # This ensures newly joined players (added via HTTP API) are visible.
                if state.get('game_status') == 'LOBBY':
                    room = Room.objects.get(code=self.room_code)
                    db_players = RoomPlayer.objects.filter(room=room).order_by('slot_index')
                    state_player_ids = {p['id'] for p in state['players']}
                    for dp in db_players:
                        pid = str(dp.user.token)
                        if pid not in state_player_ids:
                            # New player — add them as offline; their own connect event will flip it
                            state['players'].append({
                                'id': pid,
                                'name': dp.user.nickname,
                                'is_connected': False,
                                'called_uno': False,
                                'avatar_url': dp.user.avatar.url if dp.user.avatar else None
                            })

                # Update the current player's own connection status
                found = False
                for p in state['players']:
                    if p['id'] == str(self.user.token):
                        p['is_connected'] = is_connected
                        found = True
                        break

                if not found and is_connected:
                    # Fallback: add player if still missing (e.g., race condition)
                    state['players'].append({
                        'id': str(self.user.token),
                        'name': self.user.nickname,
                        'is_connected': True,
                        'called_uno': False,
                        'avatar_url': self.user.avatar.url if self.user.avatar else None
                    })

                # Save updated status
                self.state_manager.save_state(self.room_code, state)

        try:
            await database_sync_to_async(update_connection_sync)()
        except Exception as e:
            print("Failed to update connection status in Redis:", e)

    @database_sync_to_async
    def verify_room_membership(self):
        try:
            room = Room.objects.get(code=self.room_code)
            return RoomPlayer.objects.filter(room=room, user=self.user).exists()
        except Room.DoesNotExist:
            return False

    async def broadcast_room_state(self):
        try:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "state_broadcast",
                    "room_code": self.room_code
                }
            )
        except Exception as e:
            print(f"[broadcast_room_state ERROR] room={self.room_code}: {e}")

    async def state_broadcast(self, event):
        try:
            room_code = event['room_code']
            state = await database_sync_to_async(self.state_manager.get_state)(room_code)
            if not state:
                state = await database_sync_to_async(self.initialize_lobby_state)()

            # Build player-specific state to secure details (no card leakage)
            filtered = self.state_manager.filter_state_for_player(state, str(self.user.token))
            
            await self.send_json({
                "type": "game_state_update",
                "version": state.get('version', 0),
                "state": filtered
            })
        except Exception as e:
            print(f"[state_broadcast ERROR] player={getattr(self, 'user', '?')}, room={event.get('room_code', '?')}: {e}")

    async def send_single_client_state(self):
        """
        Sends state directly to this client only (e.g. on error).
        """
        try:
            state = await database_sync_to_async(self.state_manager.get_state)(self.room_code)
            if not state:
                state = await database_sync_to_async(self.initialize_lobby_state)()
            filtered = self.state_manager.filter_state_for_player(state, str(self.user.token))
            await self.send_json({
                "type": "game_state_update",
                "version": state.get('version', 0),
                "state": filtered
            })
        except Exception as e:
            print(f"[send_single_client_state ERROR] player={getattr(self, 'user', '?')}, room={self.room_code}: {e}")

    async def send_error(self, error_type, message):
        await self.send_json({
            "type": "error",
            "error_type": error_type,
            "message": message
        })

    async def chat_message(self, event):
        # Forward chat messages to the WebSocket
        await self.send_json({
            "type": "chat_message",
            "sender_id": event['sender_id'],
            "sender_name": event['sender_name'],
            "message": event['message'],
            "timestamp": event['timestamp']
        })

    async def player_kicked_broadcast(self, event):
        # Forward kick notification to the client WebSocket
        await self.send_json({
            "type": "player_kicked",
            "target_id": event['target_id'],
            "message": event['message']
        })

    async def room_closed_broadcast(self, event):
        # Forward room closed notification to the client WebSocket
        await self.send_json({
            "type": "room_closed",
            "message": event['message']
        })
