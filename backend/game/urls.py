from django.urls import path
from .views import GuestRegisterView, RoomCreateView, RoomJoinView, RoomDetailView, GameHistoryListView

urlpatterns = [
    path('auth/guest/', GuestRegisterView.as_view(), name='guest_register'),
    path('rooms/', RoomCreateView.as_view(), name='room_create'),
    path('rooms/<str:code>/', RoomDetailView.as_view(), name='room_detail'),
    path('rooms/<str:code>/join/', RoomJoinView.as_view(), name='room_join'),
    path('history/', GameHistoryListView.as_view(), name='game_history'),
]
