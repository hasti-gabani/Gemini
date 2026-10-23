"""Session timeout and security headers."""
import time

from django.conf import settings
from django.contrib.auth import logout

SESSION_LOGIN_AT = 'login_at'
SESSION_LAST_SEEN = 'last_seen'
TOUCH_EVERY_SECONDS = 60  # avoid a session write on every request


def start_session_clock(request):
    now = int(time.time())
    request.session[SESSION_LOGIN_AT] = now
    request.session[SESSION_LAST_SEEN] = now


def idle_timeout_seconds():
    return max(1, int(getattr(settings, 'SESSION_IDLE_MINUTES', 60))) * 60


def max_session_seconds():
    return max(1, int(getattr(settings, 'SESSION_MAX_HOURS', 12))) * 3600


class SessionTimeoutMiddleware:
    """Sign the user out after a period without activity, and after a maximum session age,
    however active they are. Must come after AuthenticationMiddleware."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated:
            now = int(time.time())
            session = request.session
            started = session.get(SESSION_LOGIN_AT)
            last = session.get(SESSION_LAST_SEEN)
            if started is None:  # session from before timeouts existed: start counting now
                start_session_clock(request)
            elif (last is not None and now - last > idle_timeout_seconds()) or now - started > max_session_seconds():
                reason = 'idle' if last is not None and now - last > idle_timeout_seconds() else 'max_age'
                logout(request)
                request.session_timed_out = reason
            elif last is None or now - last >= TOUCH_EVERY_SECONDS:
                session[SESSION_LAST_SEEN] = now
        return self.get_response(request)


def timeout_message(reason):
    if reason == 'max_age':
        return (f'For your security you are signed out {getattr(settings, "SESSION_MAX_HOURS", 12)} hours after '
                'signing in. Please sign in again.')
    return (f'For your security you were signed out after {getattr(settings, "SESSION_IDLE_MINUTES", 60)} '
            'minutes without activity. Please sign in again.')


# The web app loads only its own scripts, styles, fonts and images. Inline style attributes
# (React `style`) need 'unsafe-inline' for styles; scripts must come from files.
CONTENT_SECURITY_POLICY = '; '.join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
])
PERMISSIONS_POLICY = 'geolocation=(), microphone=(), payment=(), usb=()'


class SecurityHeadersMiddleware:
    """Content-Security-Policy for HTML pages (not PDFs or files, whose built-in browser
    viewers a CSP can break) and a restrictive Permissions-Policy everywhere."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        content_type = response.get('Content-Type', '')
        if content_type.startswith('text/html') and 'Content-Security-Policy' not in response:
            response['Content-Security-Policy'] = CONTENT_SECURITY_POLICY
        response.setdefault('Permissions-Policy', PERMISSIONS_POLICY)
        return response
