from rest_framework import authentication
from rest_framework import exceptions
from channels.db import database_sync_to_async
from urllib.parse import parse_qs
from .models import GuestUser

class GuestAuthentication(authentication.BaseAuthentication):
    def authenticate(self, request):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return None

        parts = auth_header.split()
        if len(parts) != 2:
            return None

        auth_type, token_str = parts
        if auth_type.lower() not in ('token', 'bearer'):
            return None

        try:
            user = GuestUser.objects.get(token=token_str)
        except (GuestUser.DoesNotExist, ValueError):
            raise exceptions.AuthenticationFailed('Invalid token.')

        # Mock fields to satisfy DRF / Django internal checks
        return (user, None)

class WebSocketTokenAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query_string = scope.get('query_string', b'').decode()
        query_params = parse_qs(query_string)
        token_list = query_params.get('token')

        user = None
        if token_list:
            token_str = token_list[0]
            user = await self.get_user(token_str)

        scope['user'] = user
        return await self.inner(scope, receive, send)

    @database_sync_to_async
    def get_user(self, token_str):
        try:
            user = GuestUser.objects.get(token=token_str)
            return user
        except (GuestUser.DoesNotExist, ValueError):
            return None
