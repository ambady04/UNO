import random
from rest_framework import status, views
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from datetime import timedelta
from django.utils import timezone
from .models import GuestUser, Room, RoomPlayer
from .serializers import GuestUserSerializer, RoomSerializer

def clean_old_rooms_helper():
    """Deletes rooms that were created more than 2 hours ago."""
    threshold = timezone.now() - timedelta(hours=2)
    Room.objects.filter(created_at__lt=threshold).delete()

def generate_room_code():
    LETTERS = "ACDEFGHJKLMNPQRTUVWXY"
    DIGITS  = "2346789"
    ALL     = LETTERS + DIGITS
    while True:
        # Guarantee at least 2 letters + 2 digits; shuffle so positions are random
        parts = (
            random.choices(LETTERS, k=2) +
            random.choices(DIGITS,  k=2) +
            random.choices(ALL,     k=2)
        )
        random.shuffle(parts)
        code = ''.join(parts)
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
        clean_old_rooms_helper()
        code = generate_room_code()
        room = Room.objects.create(code=code, host=request.user, status='LOBBY')
        RoomPlayer.objects.create(room=room, user=request.user, slot_index=0)
        
        serializer = RoomSerializer(room)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

@method_decorator(csrf_exempt, name='dispatch')
class RoomJoinView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, code):
        clean_old_rooms_helper()
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
        clean_old_rooms_helper()
        code = code.upper()
        try:
            room = Room.objects.get(code=code)
        except Room.DoesNotExist:
            return Response({'error': 'Room not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = RoomSerializer(room)
        return Response(serializer.data, status=status.HTTP_200_OK)


from django.core.mail import send_mail
from .models import OTPRequest

@method_decorator(csrf_exempt, name='dispatch')
class SendOTPView(views.APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        if not email:
            return Response({'error': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Generate 6 digit code
        code = f"{random.randint(100000, 999999)}"
        expires_at = timezone.now() + timedelta(minutes=5)
        
        # Create OTP Request
        OTPRequest.objects.create(email=email, otp_code=code, expires_at=expires_at)
        
        # Send Email
        try:
            send_mail(
                subject="Your UNO! Verification Code",
                message=f"Your verification code is: {code}\nThis code will expire in 5 minutes.",
                from_email="noreply@uno-game.com",
                recipient_list=[email],
                fail_silently=False,
            )
        except Exception as e:
            return Response({'error': f'Failed to send email: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({'message': 'OTP sent successfully. Please check your email/console.'}, status=status.HTTP_200_OK)

@method_decorator(csrf_exempt, name='dispatch')
class VerifyOTPView(views.APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        code = request.data.get('otp', '').strip()
        nickname = request.data.get('nickname', '').strip() or email.split('@')[0]
        
        if not email or not code:
            return Response({'error': 'Email and OTP are required.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Check OTP
        otp_reqs = OTPRequest.objects.filter(
            email=email, 
            otp_code=code, 
            expires_at__gt=timezone.now()
        ).order_by('-created_at')
        
        if not otp_reqs.exists():
            return Response({'error': 'Invalid or expired OTP.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Retrieve or create GuestUser
        user, created = GuestUser.objects.get_or_create(email=email)
        user.is_registered = True
        if created or not user.nickname:
            user.nickname = nickname
        user.save()
        
        # Clean up verified OTPs
        otp_reqs.delete()
        
        serializer = GuestUserSerializer(user)
        return Response({
            'token': str(user.token),
            'user': serializer.data
        }, status=status.HTTP_200_OK)

@method_decorator(csrf_exempt, name='dispatch')
class UserProfileView(views.APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = GuestUserSerializer(request.user, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        user = request.user
        nickname = request.data.get('nickname', '').strip()
        avatar = request.FILES.get('avatar')
        
        if nickname:
            if len(nickname) > 50:
                return Response({'error': 'Nickname must be 50 characters or less.'}, status=status.HTTP_400_BAD_REQUEST)
            user.nickname = nickname
            
        if avatar:
            user.avatar = avatar
            
        user.save()

        # Proactively sync profile changes to any active game lobbies in Redis
        try:
            from .state_manager import GameStateManager
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync

            state_manager = GameStateManager()
            channel_layer = get_channel_layer()
            active_memberships = RoomPlayer.objects.filter(user=user)

            for membership in active_memberships:
                room_code = membership.room.code
                try:
                    with state_manager.lock_room(room_code):
                        state = state_manager.get_state(room_code)
                        if state:
                            for p in state.get('players', []):
                                if p['id'] == str(user.token):
                                    p['name'] = user.nickname
                                    p['avatar_url'] = user.avatar.url if user.avatar else None
                                    break
                            state_manager.save_state(room_code, state)
                    
                    # Trigger room state broadcast to let other clients know
                    async_to_sync(channel_layer.group_send)(
                        f"room_{room_code}",
                        {
                            "type": "state_broadcast",
                            "room_code": room_code
                        }
                    )
                except Exception as e:
                    print(f"Failed to sync profile update to Redis room {room_code}: {e}")
        except Exception as e:
            print(f"Failed to load channels/state_manager: {e}")

        serializer = GuestUserSerializer(user, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)

