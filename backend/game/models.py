import uuid
from django.db import models

class GuestUser(models.Model):
    token = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nickname = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def __str__(self):
        return f"{self.nickname} ({str(self.token)[:8]})"

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

class GameHistory(models.Model):
    room_code = models.CharField(max_length=6)
    winner = models.ForeignKey(GuestUser, on_delete=models.SET_NULL, null=True, blank=True)
    winner_name = models.CharField(max_length=50)
    duration_seconds = models.IntegerField(default=0)
    played_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"History of {self.room_code} won by {self.winner_name}"
