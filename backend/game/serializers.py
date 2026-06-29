from rest_framework import serializers
from .models import GuestUser, Room, RoomPlayer

class GuestUserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = GuestUser
        fields = ['token', 'nickname', 'email', 'is_registered', 'avatar', 'avatar_url', 'created_at']

    def get_avatar_url(self, obj):
        if obj.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.avatar.url)
            return obj.avatar.url
        return None

class RoomPlayerSerializer(serializers.ModelSerializer):
    nickname = serializers.CharField(source='user.nickname', read_only=True)
    user_id = serializers.CharField(source='user.token', read_only=True)
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = RoomPlayer
        fields = ['user_id', 'nickname', 'slot_index', 'avatar_url']

    def get_avatar_url(self, obj):
        if obj.user.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.user.avatar.url)
            return obj.user.avatar.url
        return None

class RoomSerializer(serializers.ModelSerializer):
    players = RoomPlayerSerializer(source='players_relations', many=True, read_only=True)
    host_nickname = serializers.CharField(source='host.nickname', read_only=True)
    host_id = serializers.CharField(source='host.token', read_only=True)

    class Meta:
        model = Room
        fields = ['code', 'status', 'host_id', 'host_nickname', 'players', 'created_at']

