from django.contrib import admin
from .models import GuestUser, Room, RoomPlayer, OTPRequest

@admin.register(GuestUser)
class GuestUserAdmin(admin.ModelAdmin):
    list_display = ('nickname', 'email', 'is_registered', 'avatar', 'token', 'created_at')
    search_fields = ('nickname', 'email', 'token')
    list_filter = ('is_registered', 'created_at')

@admin.register(OTPRequest)
class OTPRequestAdmin(admin.ModelAdmin):
    list_display = ('email', 'otp_code', 'created_at', 'expires_at')
    search_fields = ('email', 'otp_code')
    list_filter = ('created_at',)

@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('code', 'host', 'status', 'created_at', 'updated_at')
    search_fields = ('code', 'host__nickname')
    list_filter = ('status', 'created_at')

@admin.register(RoomPlayer)
class RoomPlayerAdmin(admin.ModelAdmin):
    list_display = ('room', 'user', 'slot_index', 'joined_at')
    search_fields = ('room__code', 'user__nickname')
    list_filter = ('joined_at',)
