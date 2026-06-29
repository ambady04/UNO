from django.urls import path
from .views import GuestRegisterView, RoomCreateView, RoomJoinView, RoomDetailView, SendOTPView, VerifyOTPView, UserProfileView

urlpatterns = [
    path('auth/guest/', GuestRegisterView.as_view(), name='guest_register'),
    path('auth/send-otp/', SendOTPView.as_view(), name='send_otp'),
    path('auth/verify-otp/', VerifyOTPView.as_view(), name='verify_otp'),
    path('user/profile/', UserProfileView.as_view(), name='user_profile'),
    path('rooms/', RoomCreateView.as_view(), name='room_create'),
    path('rooms/<str:code>/', RoomDetailView.as_view(), name='room_detail'),
    path('rooms/<str:code>/join/', RoomJoinView.as_view(), name='room_join'),
]

