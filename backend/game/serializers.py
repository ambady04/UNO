from rest_framework import serializers
from .models import GuestUser, Room, RoomPlayer, GameHistory

class GuestUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = GuestUser
        fields = ['token', 'nickname', 'created_at']

class RoomPlayerSerializer(serializers.ModelSerializer):
    nickname = serializers.CharField(source='user.nickname', read_only=True)
    user_id = serializers.CharField(source='user.token', read_only=True)

    class Meta:
        model = RoomPlayer
        fields = ['user_id', 'nickname', 'slot_index']

class RoomSerializer(serializers.ModelSerializer):
    players = RoomPlayerSerializer(source='players_relations', many=True, read_only=True)
    host_nickname = serializers.CharField(source='host.nickname', read_only=True)
    host_id = serializers.CharField(source='host.token', read_only=True)

    class Meta:
        model = Room
        fields = ['code', 'status', 'host_id', 'host_nickname', 'players', 'created_at']

class GameHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = GameHistory
        fields = ['room_code', 'winner_name', 'duration_seconds', 'played_at']
