"""Payment reminder messages and share links (WhatsApp / SMS)."""
import re
from collections import defaultdict
from urllib.parse import quote

from core.dates import fmt_date, today
from core.money import fmt_money


def _template(business):
    from accounts.models import DEFAULT_REMINDER_TEMPLATE
    settings = getattr(business, 'settings', None)
    return (settings.reminder_template if settings and settings.reminder_template else DEFAULT_REMINDER_TEMPLATE)


def render_message(business, party, amount, due_date=None):
    """Fill the reminder template. Unknown {placeholders} are left as-is."""
    values = defaultdict(str, {
        'name': party.name,
        'amount': fmt_money(amount, symbol='').strip(),
        'due_date': fmt_date(due_date) if due_date else fmt_date(today()),
        'business': business.name,
        'phone': business.phone,
    })

    def replace(match):
        key = match.group(1)
        return values[key] if key in values else match.group(0)

    return re.sub(r'\{(\w+)\}', replace, _template(business)).strip()


def whatsapp_number(phone):
    digits = re.sub(r'\D', '', phone or '')
    if len(digits) == 10:
        return '91' + digits
    if len(digits) == 11 and digits.startswith('0'):
        return '91' + digits[1:]
    return digits


def share_links(phone, text):
    number = whatsapp_number(phone)
    encoded = quote(text)
    return {
        'text': text,
        'whatsapp_url': f'https://wa.me/{number}?text={encoded}' if number else f'https://wa.me/?text={encoded}',
        'sms_url': f'sms:{phone or ""}?body={encoded}',
        'phone': phone or '',
    }
