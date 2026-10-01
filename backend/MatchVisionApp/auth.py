import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .models import AuthToken

# A login stays valid while it is used at least once in this period
TOKEN_TTL = timedelta(days=60)


def digest(key):
    return hashlib.sha256(key.encode()).hexdigest()


def issue_token(user):
    """New login on one device: the key is returned once, only its hash is stored."""
    key = secrets.token_urlsafe(32)
    AuthToken.objects.create(user=user, digest=digest(key))
    return key


class TokenAuthentication(BaseAuthentication):
    """Header 'Authorization: Token <key>'. Each device has its own token, so logging out
    on the phone does not log out the tablet that is scouting the match."""

    keyword = b'token'

    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword:
            return None
        if len(header) != 2:
            raise AuthenticationFailed('Token non valido')
        try:
            key = header[1].decode()
        except UnicodeError:
            raise AuthenticationFailed('Token non valido')
        token = AuthToken.objects.select_related('user').filter(digest=digest(key)).first()
        if token is None or not token.user.is_active:
            raise AuthenticationFailed('Sessione scaduta: accedi di nuovo')
        now = timezone.now()
        if now - token.last_used > TOKEN_TTL:
            token.delete()
            raise AuthenticationFailed('Sessione scaduta: accedi di nuovo')
        # At most one write per hour per device
        if now - token.last_used > timedelta(hours=1):
            AuthToken.objects.filter(pk=token.pk).update(last_used=now)
        return (token.user, token)

    def authenticate_header(self, request):
        # Makes DRF answer 401 (not 403) to requests without a valid token
        return 'Token'
