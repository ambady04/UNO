import uuid
from django.db import models

class GuestUser(models.Model):
    token = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nickname = models.CharField(max_length=50)
    email = models.EmailField(unique=True, null=True, blank=True)
    is_registered = models.BooleanField(default=False)
    avatar = models.ImageField(upload_to="avatars/", null=True, blank=True)
    password_hash = models.CharField(max_length=128, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def set_password(self, raw_password):
        from django.contrib.auth.hashers import make_password
        self.password_hash = make_password(raw_password)

    def check_password(self, raw_password):
        if not self.password_hash:
            return False
        from django.contrib.auth.hashers import check_password
        return check_password(raw_password, self.password_hash)

    def __str__(self):
        return f"{self.nickname} ({str(self.token)[:8]})"

class OTPRequest(models.Model):
    email = models.EmailField()
    otp_code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"{self.email} - {self.otp_code}"

class Room(models.Model):
    STATUS_CHOICES = (
        ('LOBBY', 'Lobby'),
        ('PLAYING', 'Playing'),
        ('FINISHED', 'Finished'),
    )
    code = models.CharField(max_length=6, unique=True)
    host = models.ForeignKey(GuestUser, on_delete=models.CASCADE, related_name='hosted_rooms')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='LOBBY')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Room {self.code} ({self.status})"

class RoomPlayer(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='players_relations')
    user = models.ForeignKey(GuestUser, on_delete=models.CASCADE)
    slot_index = models.IntegerField(default=0)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('room', 'user')
        ordering = ['slot_index']

    def __str__(self):
        return f"{self.user.nickname} in {self.room.code}"


