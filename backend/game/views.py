import random
from django.conf import settings
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
    """
    Cleanup expired database records.

    - Deletes expired OTP requests.
    - Deletes rooms older than ROOM_EXPIRY_HOURS.
    - RoomPlayer records are deleted automatically because of CASCADE.
    """

    now = timezone.now()

    # Delete expired OTPs
    OTPRequest.objects.filter(expires_at__lte=now).delete()

    # Delete expired rooms
    room_threshold = now - timedelta(hours=ROOM_EXPIRY_HOURS)
    Room.objects.filter(created_at__lte=room_threshold).delete()

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
        clean_old_rooms_helper()
        email = request.data.get('email', '').strip().lower()
        if not email:
            return Response({'error': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Generate 6 digit code
        code = f"{random.randint(100000, 999999)}"
        expires_at = timezone.now() + timedelta(minutes=5)
        
        # Create OTP Request
        OTPRequest.objects.create(email=email, otp_code=code, expires_at=expires_at)
        
        # HTML Email Message
        html_message = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Your UNO! Verification Code</title>
            <style>
                body {{
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background-color: #0f172a;
                    color: #f8fafc;
                    margin: 0;
                    padding: 0;
                    -webkit-font-smoothing: antialiased;
                }}
                .email-container {{
                    max-width: 500px;
                    margin: 40px auto;
                    background: #1e293b;
                    border: 1px solid #334155;
                    border-radius: 16px;
                    padding: 32px;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
                    text-align: center;
                }}
                .header {{
                    margin-bottom: 24px;
                }}
                .header h1 {{
                    color: #ffcc00;
                    font-size: 24px;
                    font-weight: 800;
                    letter-spacing: 1px;
                    margin: 0;
                }}
                .content {{
                    line-height: 1.6;
                    font-size: 15px;
                    color: #cbd5e1;
                    text-align: left;
                }}
                .content p {{
                    margin: 0 0 16px 0;
                }}
                .otp-box {{
                    background: #0f172a;
                    border: 1.5px dashed #3388ff;
                    border-radius: 12px;
                    padding: 18px;
                    text-align: center;
                    margin: 24px 0;
                }}
                .otp-code {{
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 34px;
                    font-weight: 800;
                    letter-spacing: 6px;
                    color: #38bdf8;
                    margin: 0;
                    padding-left: 6px;
                }}
                .footer {{
                    margin-top: 32px;
                    border-top: 1px solid #334155;
                    padding-top: 20px;
                    font-size: 11px;
                    color: #64748b;
                    text-align: center;
                }}
                .footer a {{
                    color: #38bdf8;
                    text-decoration: none;
                    font-weight: 600;
                }}
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="header">
                    <h1>🃏 UNO! MULTIPLAYER</h1>
                </div>
                <div class="content">
                    <p>Hello,</p>
                    <p>Use the verification code below to log in or register your <strong>UNO! Multiplayer</strong> account:</p>
                    
                    <div class="otp-box">
                        <div class="otp-code">{code}</div>
                    </div>
                    
                    <p>This code will expire in <strong>5 minutes</strong>. If you did not request this code, you can safely ignore this email.</p>
                </div>
                <div class="footer">
                    <p>Played with ❤️ by <a href="https://ambady.space" target="_blank">Ambady</a></p>
                    <p>&copy; 2026 UNO! Multiplayer. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """

        # Send Email
        try:
            send_mail(
                subject="Your UNO! Verification Code",
                message=f"Your verification code is: {code}\nThis code will expire in 5 minutes.",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                fail_silently=False,
                html_message=html_message
            )
        except Exception as e:
            return Response({'error': f'Failed to send email: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({'message': 'OTP sent successfully. Please check your email.'}, status=status.HTTP_200_OK)

@method_decorator(csrf_exempt, name='dispatch')
class VerifyOTPView(views.APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        clean_old_rooms_helper()
        email = request.data.get('email', '').strip().lower()
        code = request.data.get('otp', '').strip()
        nickname = request.data.get('nickname', '').strip() or email.split('@')[0]
        password = request.data.get('password', '').strip()
        
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
        if password:
            user.set_password(password)
        user.save()
        
        # Clean up verified OTPs
        otp_reqs.delete()
        
        serializer = GuestUserSerializer(user)
        return Response({
            'token': str(user.token),
            'user': serializer.data
        }, status=status.HTTP_200_OK)

@method_decorator(csrf_exempt, name='dispatch')
class PasswordLoginView(views.APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        password = request.data.get('password', '').strip()
        
        if not email or not password:
            return Response({'error': 'Email and Password are required.'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user = GuestUser.objects.get(email=email)
        except GuestUser.DoesNotExist:
            return Response({'error': 'No account exists with this email. Please sign up first.'}, status=status.HTTP_404_NOT_FOUND)
        
        if not user.check_password(password):
            return Response({'error': 'Incorrect password.'}, status=status.HTTP_400_BAD_REQUEST)
            
        serializer = GuestUserSerializer(user)
        return Response({
            'token': str(user.token),
            'user': serializer.data
        }, status=status.HTTP_200_OK)

@method_decorator(csrf_exempt, name='dispatch')
class CheckEmailView(views.APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        if not email:
            return Response({'error': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            user = GuestUser.objects.get(email=email)
            has_password = bool(user.password_hash)
            return Response({
                'exists': True,
                'has_password': has_password,
                'nickname': user.nickname
            }, status=status.HTTP_200_OK)
        except GuestUser.DoesNotExist:
            return Response({
                'exists': False,
                'has_password': False
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

