"""
ASGI config for uno_project project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'uno_project.settings')
django_asgi_app = get_asgi_application()

# Import routing and custom middleware after django_asgi_app is initialized
from game.routing import websocket_urlpatterns
from game.auth import WebSocketTokenAuthMiddleware

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": WebSocketTokenAuthMiddleware(
        URLRouter(
            websocket_urlpatterns
        )
    ),
})
