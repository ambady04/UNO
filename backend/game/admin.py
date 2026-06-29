from django.contrib import admin
from .models import GuestUser, Room, RoomPlayer

@admin.register(GuestUser)
class GuestUserAdmin(admin.ModelAdmin):
    list_display = ('nickname', 'token', 'created_at')
    search_fields = ('nickname', 'token')
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
