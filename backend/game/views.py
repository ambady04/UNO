import random
import string
from rest_framework import status, views
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from .models import GuestUser, Room, RoomPlayer, GameHistory
from .serializers import GuestUserSerializer, RoomSerializer, GameHistorySerializer

def generate_room_code():
    while True:
        code = ''.join(random.choices(string.ascii_uppercase, k=6))
        if not Room.objects.filter(code=code).exists():
            return code

@method_decorator(csrf_exempt, name='dispatch')
class GuestRegisterView(views.APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        nickname = request.data.get('nickname', '').strip()
        if not nickname:
            return Response({'error': 'Nickname is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(nickname) > 50:
            return Response({'error': 'Nickname must be 50 characters or less.'}, status=status.HTTP_400_BAD_REQUEST)

        user = GuestUser.objects.create(nickname=nickname)
        serializer = GuestUserSerializer(user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

@method_decorator(csrf_exempt, name='dispatch')
class RoomCreateView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        code = generate_room_code()
        room = Room.objects.create(code=code, host=request.user, status='LOBBY')
        RoomPlayer.objects.create(room=room, user=request.user, slot_index=0)
        
        serializer = RoomSerializer(room)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

@method_decorator(csrf_exempt, name='dispatch')
class RoomJoinView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, code):
        code = code.upper()
        try:
            room = Room.objects.get(code=code)
        except Room.DoesNotExist:
            return Response({'error': 'Room not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Check if already in room
        player_exists = RoomPlayer.objects.filter(room=room, user=request.user).exists()
        if player_exists:
            serializer = RoomSerializer(room)
            return Response(serializer.data, status=status.HTTP_200_OK)

        # Enforce joins only in LOBBY state
        if room.status != 'LOBBY':
            return Response({'error': 'Game has already started or finished.'}, status=status.HTTP_400_BAD_REQUEST)

        # Enforce max 10 players per room
        current_players = RoomPlayer.objects.filter(room=room)
        if current_players.count() >= 10:
            return Response({'error': 'Room is full (maximum 10 players).'}, status=status.HTTP_400_BAD_REQUEST)

        # Add player
        slot_index = current_players.count()
        RoomPlayer.objects.create(room=room, user=request.user, slot_index=slot_index)

        serializer = RoomSerializer(room)
        return Response(serializer.data, status=status.HTTP_200_OK)

class RoomDetailView(views.APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, code):
        code = code.upper()
        try:
            room = Room.objects.get(code=code)
        except Room.DoesNotExist:
            return Response({'error': 'Room not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = RoomSerializer(room)
        return Response(serializer.data, status=status.HTTP_200_OK)

class GameHistoryListView(views.APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        histories = GameHistory.objects.all().order_by('-played_at')[:10]
        serializer = GameHistorySerializer(histories, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
