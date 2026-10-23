"""Unguessable, revocable links for sharing bills with customers.

Token = "<kind>-<id>-<signature>". The signature is an HMAC over the record id
and the business `share_salt`, so resetting the salt (Settings → Reset share
links) invalidates every link shared so far.
"""
import base64
import hashlib
import hmac

from django.conf import settings

KINDS = {'s': 'sale', 'p': 'purchase', 'r': 'payment_in', 'v': 'payment_out'}
KIND_CODES = {value: key for key, value in KINDS.items()}


def _signature(kind_code, record_id, business):
    message = f'{kind_code}:{record_id}:{business.id}:{business.share_salt}'.encode()
    digest = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest[:18]).decode().rstrip('=')


def make_token(kind, record):
    code = KIND_CODES[kind]
    return f'{code}-{record.id}-{_signature(code, record.id, record.business)}'


def parse_token(token):
    """Return (kind, id, signature) or None when malformed."""
    try:
        code, raw_id, signature = (token or '').split('-', 2)
        return KINDS[code], int(raw_id), signature
    except (ValueError, KeyError):
        return None


def verify(kind, record, signature):
    code = KIND_CODES[kind]
    return hmac.compare_digest(_signature(code, record.id, record.business), signature or '')
