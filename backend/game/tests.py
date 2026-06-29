import time
import json
import uuid
import redis
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import GuestUser, Room, RoomPlayer
from .state_manager import GameStateManager, VersionMismatchError
from . import game_logic

class GuestAuthAPITests(APITestCase):
    def test_guest_registration_success(self):
        url = reverse('guest_register')
        response = self.client.post(url, {'nickname': 'Alice'})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('token', response.data)
        self.assertEqual(response.data['nickname'], 'Alice')

    def test_guest_registration_empty_nickname(self):
        url = reverse('guest_register')
        response = self.client.post(url, {'nickname': ''})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class RoomAPITests(APITestCase):
    def setUp(self):
        # Create a guest user
        self.user1 = GuestUser.objects.create(nickname='Alice')
        self.user2 = GuestUser.objects.create(nickname='Bob')
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1.token}')

    def test_create_room_success(self):
        url = reverse('room_create')
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('code', response.data)
        self.assertEqual(response.data['status'], 'LOBBY')
        self.assertEqual(response.data['host_id'], str(self.user1.token))

    def test_join_room_success(self):
        # Create a room
        room = Room.objects.create(code='JOINME', host=self.user1, status='LOBBY')
        RoomPlayer.objects.create(room=room, user=self.user1, slot_index=0)

        # Authenticate user 2
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user2.token}')
        url = reverse('room_join', kwargs={'code': 'JOINME'})
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Verify user 2 joined
        self.assertEqual(RoomPlayer.objects.filter(room=room).count(), 2)

    def test_join_room_full(self):
        room = Room.objects.create(code='FULLRM', host=self.user1, status='LOBBY')
        # Add 6 players
        for i in range(6):
            u = GuestUser.objects.create(nickname=f'User_{i}')
            RoomPlayer.objects.create(room=room, user=u, slot_index=i)

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user2.token}')
        url = reverse('room_join', kwargs={'code': 'FULLRM'})
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('full', response.data['error'])


class UnoGameEngineTests(TestCase):
    def setUp(self):
        self.players = [
            {"id": "p1", "name": "Alice"},
            {"id": "p2", "name": "Bob"},
            {"id": "p3", "name": "Charlie"}
        ]
        self.state = game_logic.initialize_game(self.players)

    def test_deck_setup(self):
        # Initial hands: 3 players * 7 cards = 21 cards
        # Discard pile: 1 card
        # Remaining deck: 108 - 21 - 1 = 86 cards
        self.assertEqual(len(self.state['deck']), 86)
        self.assertEqual(len(self.state['discard_pile']), 1)
        self.assertEqual(len(self.state['hands']['p1']), 7)
        game_logic.check_deck_integrity(self.state)

    def test_invalid_turn_play(self):
        # p1's turn is current_turn = 0
        self.state['current_turn'] = 0
        card_to_play = self.state['hands']['p2'][0]
        # p2 trying to play out of turn
        with self.assertRaises(ValueError):
            game_logic.handle_play_card(self.state, "p2", card_to_play)

    def test_turn_progression_clockwise(self):
        self.state['current_turn'] = 0
        self.state['direction'] = 1
        # Set top card as R_5
        self.state['discard_pile'] = ['R_5']
        self.state['current_color'] = 'R'
        self.state['current_value'] = '5'
        
        # Modify a card in p1's hand to be R_2
        self.state['hands']['p1'][0] = 'R_2'
        game_logic.handle_play_card(self.state, "p1", "R_2")
        
        # Turn should advance to Bob (index 1)
        self.assertEqual(self.state['current_turn'], 1)

    def test_turn_progression_reverse(self):
        self.state['current_turn'] = 0
        self.state['direction'] = 1
        self.state['discard_pile'] = ['R_5']
        self.state['current_color'] = 'R'
        self.state['current_value'] = '5'
        
        # Modify a card in p1's hand to be R_Reverse
        self.state['hands']['p1'][0] = 'R_Reverse'
        game_logic.handle_play_card(self.state, "p1", "R_Reverse")
        
        # Direction should be counter-clockwise (-1)
        self.assertEqual(self.state['direction'], -1)
        # In a 3-player game: (0 + (-1 * 1)) % 3 = 2 (Charlie plays next)
        self.assertEqual(self.state['current_turn'], 2)

    def test_skip_card_advances_two_steps(self):
        self.state['current_turn'] = 0
        self.state['direction'] = 1
        self.state['discard_pile'] = ['R_5']
        self.state['current_color'] = 'R'
        self.state['current_value'] = '5'
        
        # Modify a card in p1's hand to be R_Skip
        self.state['hands']['p1'][0] = 'R_Skip'
        game_logic.handle_play_card(self.state, "p1", "R_Skip")
        
        # Turn advances by 2 steps: (0 + 2) % 3 = 2 (Charlie plays next, Bob is skipped)
        self.assertEqual(self.state['current_turn'], 2)

    def test_reshuffle_deck_when_empty(self):
        # Empty the deck
        self.state['deck'] = []
        # Create a large discard pile
        self.state['discard_pile'] = ['R_1', 'B_2', 'G_3', 'Y_4']
        
        game_logic.reshuffle_discard_pile(self.state)
        # Check that top card 'Y_4' is still in discard, other 3 are in deck
        self.assertEqual(self.state['discard_pile'], ['Y_4'])
        self.assertEqual(len(self.state['deck']), 3)


class GameStateManagerTests(TestCase):
    def setUp(self):
        self.redis_client = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True, protocol=2)
        self.manager = GameStateManager(r_client=self.redis_client)
        self.room_code = 'TEST12'
        self.state = {
            'room_code': self.room_code,
            'game_status': 'PLAYING',
            'version': 5,
            'current_turn': 0,
            'direction': 1,
            'deck': ['R_1'] * 80,
            'discard_pile': ['B_9'],
            'current_color': 'B',
            'current_value': '9',
            'players': [
                {'id': 'u1', 'name': 'Alice', 'is_connected': True, 'called_uno': False},
                {'id': 'u2', 'name': 'Bob', 'is_connected': True, 'called_uno': False}
            ],
            'hands': {
                'u1': ['R_2'] * 13,
                'u2': ['R_3'] * 14
            }
        }
        # Clear any pre-existing keys in Redis
        self.redis_client.delete(self.manager.get_game_key(self.room_code))

    def tearDown(self):
        self.redis_client.delete(self.manager.get_game_key(self.room_code))
        self.redis_client.delete(self.manager.get_lock_key(self.room_code))

    def test_save_and_get_state(self):
        self.manager.save_state(self.room_code, self.state)
        retrieved = self.manager.get_state(self.room_code)
        
        self.assertEqual(retrieved['room_code'], self.room_code)
        # Version should have incremented from 5 to 6
        self.assertEqual(retrieved['version'], 6)

    def test_version_validation_mismatch(self):
        self.manager.save_state(self.room_code, self.state) # saved with version 6
        
        retrieved = self.manager.get_state(self.room_code)
        
        # Client tries to act on version 5 (outdated)
        with self.assertRaises(VersionMismatchError):
            self.manager.verify_client_version(retrieved, 5)

    def test_version_validation_match(self):
        self.manager.save_state(self.room_code, self.state) # saved with version 6
        retrieved = self.manager.get_state(self.room_code)
        
        # Verification passes on matching version 6
        self.manager.verify_client_version(retrieved, 6)

    def test_locking_context_manager(self):
        with self.manager.lock_room(self.room_code):
            # Try to acquire lock again (should raise TimeoutError)
            with self.assertRaises(TimeoutError):
                with self.manager.lock_room(self.room_code, timeout=1):
                    pass


class PlayerKickTests(TestCase):
    def setUp(self):
        self.redis_client = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True, protocol=2)
        self.manager = GameStateManager(r_client=self.redis_client)
        self.room_code = 'KICK99'
        self.redis_client.delete(self.manager.get_game_key(self.room_code))

    def tearDown(self):
        self.redis_client.delete(self.manager.get_game_key(self.room_code))
        self.redis_client.delete(self.manager.get_lock_key(self.room_code))

    def test_kick_in_lobby_state(self):
        lobby_state = {
            'room_code': self.room_code,
            'game_status': 'LOBBY',
            'version': 1,
            'players': [
                {'id': 'u1', 'name': 'Alice', 'is_connected': True, 'called_uno': False},
                {'id': 'u2', 'name': 'Bob', 'is_connected': True, 'called_uno': False}
            ],
            'hands': {},
            'deck': [],
            'discard_pile': ['R_0'],
            'current_turn': 0,
            'direction': 1
        }
        self.manager.save_state(self.room_code, lobby_state)
        
        # Kick Bob ('u2')
        updated = self.manager.kick_player_from_state(self.room_code, 'u2')
        self.assertEqual(len(updated['players']), 1)
        self.assertEqual(updated['players'][0]['id'], 'u1')
        self.assertEqual(updated['game_status'], 'LOBBY')

    def test_kick_in_playing_state_cards_returned_to_deck(self):
        playing_state = {
            'room_code': self.room_code,
            'game_status': 'PLAYING',
            'version': 1,
            'current_turn': 0,
            'direction': 1,
            'deck': ['R_1'] * 80,
            'discard_pile': ['B_9'],
            'current_color': 'B',
            'current_value': '9',
            'players': [
                {'id': 'u1', 'name': 'Alice', 'is_connected': True, 'called_uno': False},
                {'id': 'u2', 'name': 'Bob', 'is_connected': True, 'called_uno': False},
                {'id': 'u3', 'name': 'Charlie', 'is_connected': True, 'called_uno': False}
            ],
            'hands': {
                'u1': ['R_2'] * 9,
                'u2': ['R_3'] * 9,
                'u3': ['R_4'] * 9
            }
        }
        self.manager.save_state(self.room_code, playing_state)
        
        # Kick Charlie ('u3') who has 9 cards.
        # Initial deck has 80 cards. Charlie's cards should be returned, so deck increases to 89.
        updated = self.manager.kick_player_from_state(self.room_code, 'u3')
        self.manager.save_state(self.room_code, updated) # validates integrity
        
        self.assertEqual(len(updated['players']), 2)
        self.assertEqual(len(updated['deck']), 89)
        self.assertNotIn('u3', updated['hands'])
        game_logic.check_deck_integrity(updated)

    def test_kick_active_player_advances_turn(self):
        playing_state = {
            'room_code': self.room_code,
            'game_status': 'PLAYING',
            'version': 1,
            'current_turn': 1, # Bob is active
            'direction': 1,
            'deck': ['R_1'] * 80,
            'discard_pile': ['B_9'],
            'current_color': 'B',
            'current_value': '9',
            'players': [
                {'id': 'u1', 'name': 'Alice', 'is_connected': True, 'called_uno': False},
                {'id': 'u2', 'name': 'Bob', 'is_connected': True, 'called_uno': False},
                {'id': 'u3', 'name': 'Charlie', 'is_connected': True, 'called_uno': False}
            ],
            'hands': {
                'u1': ['R_2'] * 9,
                'u2': ['R_3'] * 9,
                'u3': ['R_4'] * 9
            }
        }
        self.manager.save_state(self.room_code, playing_state)
        
        # Kick Bob ('u2') (the active player)
        # Remaining players are ['u1', 'u3']. 
        # Bob (index 1) is kicked, so Charlie shifts from index 2 to index 1.
        # Active turn should advance from Bob to Charlie, which is index 1 in the new list.
        updated = self.manager.kick_player_from_state(self.room_code, 'u2')
        self.manager.save_state(self.room_code, updated)
        
        self.assertEqual(updated['players'][updated['current_turn']]['id'], 'u3')
        self.assertEqual(len(updated['players']), 2)

    def test_kick_reduces_players_below_two_ends_game(self):
        playing_state = {
            'room_code': self.room_code,
            'game_status': 'PLAYING',
            'version': 1,
            'current_turn': 0,
            'direction': 1,
            'deck': ['R_1'] * 90,
            'discard_pile': ['B_9'],
            'current_color': 'B',
            'current_value': '9',
            'players': [
                {'id': 'u1', 'name': 'Alice', 'is_connected': True, 'called_uno': False},
                {'id': 'u2', 'name': 'Bob', 'is_connected': True, 'called_uno': False}
            ],
            'hands': {
                'u1': ['R_2'] * 8,
                'u2': ['R_3'] * 9
            }
        }
        self.manager.save_state(self.room_code, playing_state)
        
        # Kick Bob ('u2'). Only Alice remains, game should end.
        updated = self.manager.kick_player_from_state(self.room_code, 'u2')
        self.manager.save_state(self.room_code, updated)
        
        self.assertEqual(updated['game_status'], 'FINISHED')

