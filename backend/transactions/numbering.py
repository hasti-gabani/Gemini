"""Sequential document numbers with configurable prefixes (Bil.1, PUR-1, ...)."""
from django.db.models import Max

DOC_TYPES = ('sale', 'purchase', 'payment_in', 'payment_out')


def _model(doc_type):
    from transactions.models import PaymentIn, PaymentOut, Purchase, Sale
    return {'sale': Sale, 'purchase': Purchase, 'payment_in': PaymentIn, 'payment_out': PaymentOut}[doc_type]


def prefix_and_start(settings, doc_type):
    return getattr(settings, f'{doc_type}_prefix') or '', getattr(settings, f'{doc_type}_start_number') or 1


def next_number(business, doc_type):
    prefix, start = prefix_and_start(business.settings, doc_type)
    model = _model(doc_type)
    last = model.objects.filter(business=business, prefix=prefix).aggregate(m=Max('seq'))['m'] or 0
    seq = max(last + 1, start)
    number = f'{prefix}{seq}'
    # Guard against a manually typed number that already uses this value.
    while model.objects.filter(business=business, number__iexact=number).exists():
        seq += 1
        number = f'{prefix}{seq}'
    return number, prefix, seq


def split_number(business, doc_type, number):
    """Derive (prefix, seq) for a user-supplied number so auto-numbering continues after it."""
    prefix, _ = prefix_and_start(business.settings, doc_type)
    number = (number or '').strip()
    if number.startswith(prefix):
        rest = number[len(prefix):].strip()
        if rest.isdigit():
            return prefix, int(rest)
    return '', None


def number_exists(business, doc_type, number, exclude_id=None):
    qs = _model(doc_type).objects.filter(business=business, number__iexact=(number or '').strip())
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.exists()
