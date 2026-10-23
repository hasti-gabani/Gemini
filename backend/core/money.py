"""Decimal helpers for money and quantity arithmetic.

All amounts are rounded HALF_UP to 2 decimals (paise) and quantities to 3
decimals. The frontend mirrors these exact rules with BigInt arithmetic so
live totals always match what the server stores.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

ZERO = Decimal('0.00')
CENT = Decimal('0.01')
MILLI = Decimal('0.001')
ONE = Decimal('1')
HUNDRED = Decimal('100')


def D(value):
    """Coerce a value to Decimal. Empty values become 0."""
    if value is None or value == '':
        return Decimal('0')
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value).strip().replace(',', ''))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f'Invalid number: {value!r}') from exc


def q2(value):
    return D(value).quantize(CENT, rounding=ROUND_HALF_UP)


def q3(value):
    return D(value).quantize(MILLI, rounding=ROUND_HALF_UP)


def round_rupee(value):
    return D(value).quantize(ONE, rounding=ROUND_HALF_UP)


def money_str(value):
    """API representation of an amount. Database SUM()s are not always scaled
    (SQLite returns Decimal('5000')), so always quantize before serialising."""
    return str(q2(value or 0))


def qty_str(value):
    return str(q3(value or 0))


def _group_indian(digits):
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ','.join(groups) + ',' + tail


def fmt_money(value, symbol='₹', decimals=2):
    """Format with Indian digit grouping, e.g. ₹12,34,567.50"""
    amount = q2(value)
    sign = '-' if amount < 0 else ''
    amount = abs(amount)
    text = f'{amount:.{decimals}f}'
    whole, _, frac = text.partition('.')
    result = f'{sign}{symbol}{_group_indian(whole)}'
    return f'{result}.{frac}' if decimals else result


def fmt_qty(value):
    qty = q3(value)
    text = f'{qty:f}'
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return text or '0'


_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
         'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
         'Eighteen', 'Nineteen']
_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']


def _two(n):
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + (' ' + _ONES[n % 10] if n % 10 else '')).strip()


def _three(n):
    hundreds, rest = divmod(n, 100)
    parts = []
    if hundreds:
        parts.append(_ONES[hundreds] + ' Hundred')
    if rest:
        parts.append(_two(rest))
    return ' '.join(parts)


def amount_in_words(value):
    """Indian-style amount in words: 'Ten Thousand Five Hundred Rupees and Fifty Paise Only'."""
    amount = abs(q2(value))
    rupees = int(amount)
    paise = int((amount - rupees) * 100)
    if rupees == 0 and paise == 0:
        return 'Zero Rupees Only'
    parts = []
    crore, rupees = divmod(rupees, 10_000_000)
    lakh, rupees = divmod(rupees, 100_000)
    thousand, rupees = divmod(rupees, 1000)
    if crore:
        parts.append(_three(crore) if crore < 1000 else amount_in_words(crore).replace(' Rupees Only', ''))
        parts[-1] += ' Crore'
    if lakh:
        parts.append(_two(lakh) + ' Lakh')
    if thousand:
        parts.append(_two(thousand) + ' Thousand')
    if rupees:
        parts.append(_three(rupees))
    words = ' '.join(p for p in parts if p).strip()
    result = f'{words} Rupees' if words else ''
    if paise:
        result = f'{result} and {_two(paise)} Paise' if result else f'{_two(paise)} Paise'
    return f'{result} Only'
