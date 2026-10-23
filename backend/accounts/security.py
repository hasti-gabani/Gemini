"""Sign-in lockout: after too many wrong passwords an account is locked for a while.

Two counters are kept for every failed sign-in: one for the account (or the unknown
login name) and one for the client address, so trying many passwords on one account
and trying one password on many accounts are both slowed down.
"""
import math
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core.validators import clean_phone

from .models import LoginGuard


def _minutes(value):
    return max(1, int(value))


def lock_minutes():
    return _minutes(getattr(settings, 'LOGIN_LOCK_MINUTES', 15))


def _limit(key):
    if key.startswith('ip:'):
        return max(1, int(getattr(settings, 'LOGIN_MAX_FAILURES_PER_ADDRESS', 20)))
    return max(1, int(getattr(settings, 'LOGIN_MAX_FAILURES', 5)))


def client_address(request):
    if getattr(settings, 'USE_X_FORWARDED_FOR', False):
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if forwarded:
            # The last address is the one added by our own proxy; earlier ones can be faked by the visitor.
            return forwarded.split(',')[-1].strip()[:64]
    return (request.META.get('REMOTE_ADDR') or '')[:64]


def _account_key(identifier):
    """One key per real account, whichever of username / email / mobile is typed."""
    identifier = (identifier or '').strip()
    query = Q(username__iexact=identifier) | Q(email__iexact=identifier)
    try:
        phone = clean_phone(identifier)
    except Exception:
        phone = ''
    if phone:
        query |= Q(phone=phone)
    user_id = get_user_model().objects.filter(query).order_by('id').values_list('id', flat=True).first()
    return f'user:{user_id}' if user_id else f'name:{identifier.lower()[:150]}'


def guard_keys(request, identifier):
    keys = [_account_key(identifier)]
    address = client_address(request)
    if address:
        keys.append(f'ip:{address}')
    return keys


def locked_for(keys):
    """Minutes left (rounded up) if any of the keys is locked, else 0."""
    now = timezone.now()
    until = (LoginGuard.objects.filter(key__in=keys, locked_until__gt=now)
             .order_by('-locked_until').values_list('locked_until', flat=True).first())
    if not until:
        return 0
    return max(1, math.ceil((until - now).total_seconds() / 60))


@transaction.atomic
def record_failure(keys):
    """Count a wrong password. Returns True when this attempt locked the account."""
    now = timezone.now()
    window = timedelta(minutes=lock_minutes())
    locked_now = False
    for key in keys:
        guard, _ = LoginGuard.objects.select_for_update().get_or_create(key=key)
        if guard.first_failure_at is None or now - guard.first_failure_at > window:
            guard.failures = 0
            guard.first_failure_at = now
        guard.failures += 1
        if guard.failures >= _limit(key):
            guard.locked_until = now + window
            guard.failures = 0
            guard.first_failure_at = None
            locked_now = locked_now or not key.startswith('ip:')
        guard.save()
    return locked_now


def record_success(keys):
    # A correct password clears the account counter; the address counter keeps running so
    # one good login cannot be used to reset attempts on other accounts.
    LoginGuard.objects.filter(key__in=[key for key in keys if not key.startswith('ip:')]).delete()


def lock_message(minutes):
    return (f'Too many wrong attempts. For your security, sign-in is locked for {minutes} '
            f'minute{"s" if minutes != 1 else ""}. Please try again later.')
