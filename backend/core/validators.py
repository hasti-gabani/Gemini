import re

from rest_framework import serializers

GSTIN_RE = re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
IFSC_RE = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')
PINCODE_RE = re.compile(r'^[1-9][0-9]{5}$')


def clean_phone(value, field_label='Mobile number'):
    """Normalise a phone number. Accepts 10-digit Indian mobiles, +91/0 prefixes
    and international numbers. Returns '' for empty input."""
    if value is None:
        return ''
    raw = str(value).strip()
    if not raw:
        return ''
    plus = raw.startswith('+')
    digits = re.sub(r'\D', '', raw)
    if plus and digits.startswith('91') and len(digits) == 12:
        digits = digits[2:]
        plus = False
    elif not plus and len(digits) == 12 and digits.startswith('91'):
        digits = digits[2:]
    elif not plus and len(digits) == 11 and digits.startswith('0') and digits[1] in '6789':
        digits = digits[1:]
    if plus:
        if not 8 <= len(digits) <= 15:
            raise serializers.ValidationError(f'Enter a valid {field_label.lower()}.')
        return '+' + digits
    if len(digits) == 10:
        if digits[0] not in '6789':
            raise serializers.ValidationError('Enter a valid 10-digit mobile number (starting with 6, 7, 8 or 9).')
        return digits
    if len(digits) == 11 and digits.startswith('0'):
        return digits  # landline with STD code
    raise serializers.ValidationError('Enter a valid 10-digit mobile number.')


def clean_gstin(value):
    value = (value or '').strip().upper()
    if value and not GSTIN_RE.match(value):
        raise serializers.ValidationError('Enter a valid 15-character GSTIN (e.g. 24ABCDE1234F1Z5).')
    return value


def clean_ifsc(value):
    value = (value or '').strip().upper()
    if value and not IFSC_RE.match(value):
        raise serializers.ValidationError('Enter a valid 11-character IFSC code (e.g. HDFC0001234).')
    return value


def clean_pincode(value):
    value = (value or '').strip()
    if value and not PINCODE_RE.match(value):
        raise serializers.ValidationError('Enter a valid 6-digit pincode.')
    return value


def clean_text(value, max_length=None):
    value = (value or '').strip()
    if max_length and len(value) > max_length:
        raise serializers.ValidationError(f'Keep this under {max_length} characters.')
    return value
