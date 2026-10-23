"""Date helpers: named reporting periods (Indian financial year aware)."""
from calendar import monthrange
from datetime import date, datetime, timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError

PERIODS = (
    'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
    'this_quarter', 'this_fy', 'last_fy', 'last_7_days', 'last_30_days', 'custom', 'all',
)


def today():
    return timezone.localdate()


def parse_date(value, field='date', required=False):
    if value in (None, ''):
        if required:
            raise ValidationError({field: 'This date is required.'})
        return None
    if isinstance(value, date):
        return value
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return datetime.strptime(str(value).strip(), fmt).date()
        except ValueError:
            continue
    raise ValidationError({field: 'Enter a valid date (YYYY-MM-DD).'})


def fy_start(d):
    """Indian financial year starts on 1 April."""
    return date(d.year if d.month >= 4 else d.year - 1, 4, 1)


def month_end(d):
    return d.replace(day=monthrange(d.year, d.month)[1])


def resolve_period(period=None, date_from=None, date_to=None, default='this_month'):
    """Return (start, end) dates for a named period. `all` returns (None, None)."""
    period = (period or '').strip() or None
    start = parse_date(date_from, 'date_from')
    end = parse_date(date_to, 'date_to')
    if period is None:
        if start or end:
            period = 'custom'
        else:
            period = default
    t = today()
    if period == 'today':
        return t, t
    if period == 'yesterday':
        y = t - timedelta(days=1)
        return y, y
    if period == 'this_week':
        return t - timedelta(days=t.weekday()), t
    if period == 'last_week':
        end_ = t - timedelta(days=t.weekday() + 1)
        return end_ - timedelta(days=6), end_
    if period == 'this_month':
        return t.replace(day=1), t
    if period == 'last_month':
        first_this = t.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    if period == 'this_quarter':
        q_month = ((t.month - 1) // 3) * 3 + 1
        return date(t.year, q_month, 1), t
    if period == 'this_fy':
        return fy_start(t), t
    if period == 'last_fy':
        start_this = fy_start(t)
        return date(start_this.year - 1, 4, 1), start_this - timedelta(days=1)
    if period == 'last_7_days':
        return t - timedelta(days=6), t
    if period == 'last_30_days':
        return t - timedelta(days=29), t
    if period == 'all':
        return start, end
    if period == 'custom':
        if start and end and start > end:
            raise ValidationError({'date_to': 'End date must be on or after the start date.'})
        return start, end
    raise ValidationError({'period': f'Unknown period "{period}".'})


def fmt_date(d):
    return d.strftime('%d/%m/%Y') if d else ''


def period_label(start, end):
    if start and end:
        if start == end:
            return fmt_date(start)
        return f'{fmt_date(start)} to {fmt_date(end)}'
    if start:
        return f'From {fmt_date(start)}'
    if end:
        return f'Up to {fmt_date(end)}'
    return 'All time'


def add_months(d, months):
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, min(d.day, monthrange(year, month)[1]))
