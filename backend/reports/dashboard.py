"""Home dashboard figures and the Sales vs Purchase chart."""
from datetime import date, timedelta

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import TruncMonth

from banking.models import BankAccount
from core.dates import add_months, month_end, resolve_period, today
from core.money import ZERO, money_str, q2
from inventory.models import Item
from parties.models import Party, Reminder
from transactions.models import PaymentIn, PaymentOut, Purchase, Sale


def _sum(qs, field, **filters):
    return q2(qs.filter(**filters).aggregate(s=Sum(field))['s'] or ZERO)


def _pct_change(current, previous):
    if not previous:
        return None
    return float(q2((current - previous) * 100 / previous))


def dashboard_summary(business):
    t = today()
    month_start = t.replace(day=1)
    last_month_end = month_start - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)
    last_month_same_day = last_month_start + timedelta(days=min(t.day, last_month_end.day) - 1)

    parties = Party.objects.filter(business=business).aggregate(
        receivable=Sum('balance', filter=Q(balance__gt=0)), payable=Sum('balance', filter=Q(balance__lt=0)),
        receivable_count=Count('id', filter=Q(balance__gt=0)), payable_count=Count('id', filter=Q(balance__lt=0)),
        count=Count('id'))

    sales = Sale.objects.filter(business=business)
    purchases = Purchase.objects.filter(business=business)
    payments_in = PaymentIn.objects.filter(business=business)
    payments_out = PaymentOut.objects.filter(business=business)

    month_sale = _sum(sales, 'total', date__gte=month_start, date__lte=month_end(t))
    month_purchase = _sum(purchases, 'total', date__gte=month_start, date__lte=month_end(t))
    last_month_sale_to_date = _sum(sales, 'total', date__gte=last_month_start, date__lte=last_month_same_day)
    last_month_purchase_to_date = _sum(purchases, 'total', date__gte=last_month_start, date__lte=last_month_same_day)

    accounts = BankAccount.objects.filter(business=business)
    cash_balance = _sum(accounts, 'current_balance', kind=BankAccount.KIND_CASH)
    bank_balance = _sum(accounts, 'current_balance', kind=BankAccount.KIND_BANK)

    pending = sales.filter(balance_due__gt=0).aggregate(
        total=Sum('balance_due'), count=Count('id'),
        overdue=Sum('balance_due', filter=Q(due_date__lt=t)), overdue_count=Count('id', filter=Q(due_date__lt=t)))

    low_stock_qs = Item.objects.filter(business=business, track_stock=True, is_active=True, low_stock_limit__gt=0,
                                       current_stock__lte=F('low_stock_limit'))

    lead_days = business.settings.reminder_lead_days or 0
    reminders = (Reminder.objects.filter(business=business, status=Reminder.STATUS_PENDING,
                                         due_date__lte=t + timedelta(days=lead_days))
                 .select_related('party').order_by('due_date')[:8])

    overdue_parties = (sales.filter(balance_due__gt=0, due_date__lt=t, party__isnull=False)
                       .values('party_id', 'party__name', 'party__phone')
                       .annotate(amount=Sum('balance_due'), bills=Count('id'))
                       .order_by('-amount')[:5])

    return {
        'date': t,
        'receivable': money_str(parties['receivable']),
        'payable': money_str(-(parties['payable'] or ZERO)),
        'receivable_count': parties['receivable_count'],
        'payable_count': parties['payable_count'],
        'party_count': parties['count'],
        'today_sale': str(_sum(sales, 'total', date=t)),
        'today_sale_count': sales.filter(date=t).count(),
        'today_purchase': str(_sum(purchases, 'total', date=t)),
        'today_purchase_count': purchases.filter(date=t).count(),
        'today_received': str(_sum(payments_in, 'amount', date=t)),
        'today_paid': str(_sum(payments_out, 'amount', date=t)),
        'month_sale': str(month_sale),
        'month_purchase': str(month_purchase),
        'month_sale_change': _pct_change(month_sale, last_month_sale_to_date),
        'month_purchase_change': _pct_change(month_purchase, last_month_purchase_to_date),
        'month_received': str(_sum(payments_in, 'amount', date__gte=month_start, date__lte=t)),
        'month_paid': str(_sum(payments_out, 'amount', date__gte=month_start, date__lte=t)),
        'cash_balance': str(cash_balance),
        'bank_balance': str(bank_balance),
        'bank_accounts': [
            {'id': a.id, 'name': a.name, 'kind': a.kind, 'balance': str(a.current_balance)}
            for a in accounts.filter(is_active=True).order_by('kind', '-is_default', 'name')[:6]
        ],
        'pending_sales': money_str(pending['total']),
        'pending_sales_count': pending['count'],
        'overdue_sales': money_str(pending['overdue']),
        'overdue_sales_count': pending['overdue_count'],
        'low_stock_count': low_stock_qs.count(),
        'low_stock_items': [
            {'id': i.id, 'name': i.name, 'unit': i.unit, 'current_stock': str(i.current_stock),
             'low_stock_limit': str(i.low_stock_limit)}
            for i in low_stock_qs.order_by('current_stock')[:5]
        ],
        'reminders': [
            {'id': r.id, 'party': r.party_id, 'party_name': r.party.name, 'party_phone': r.party.phone,
             'amount': str(r.amount), 'due_date': r.due_date, 'is_overdue': r.due_date < t}
            for r in reminders
        ],
        'overdue_parties': [
            {'party': row['party_id'], 'party_name': row['party__name'], 'party_phone': row['party__phone'],
             'amount': money_str(row['amount']), 'bills': row['bills']}
            for row in overdue_parties
        ],
        'recent': recent_transactions(business),
    }


def recent_transactions(business, limit=8):
    rows = []
    for model, kind, amount_field in ((Sale, 'sale', 'total'), (Purchase, 'purchase', 'total'),
                                      (PaymentIn, 'payment_in', 'amount'), (PaymentOut, 'payment_out', 'amount')):
        for obj in model.objects.filter(business=business).order_by('-created_at')[:limit]:
            rows.append({
                'type': kind, 'id': obj.id, 'number': obj.number, 'date': obj.date, 'party_name': obj.party_name,
                'amount': str(getattr(obj, amount_field)),
                'balance_due': str(obj.balance_due) if kind in ('sale', 'purchase') else None,
                'payment_status': obj.payment_status if kind in ('sale', 'purchase') else None,
                'created_at': obj.created_at,
            })
    rows.sort(key=lambda r: r['created_at'], reverse=True)
    return rows[:limit]


def chart_data(business, period=None, date_from=None, date_to=None):
    start, end = resolve_period(period, date_from, date_to, default='this_month')
    t = today()
    if end is None:
        end = t
    if start is None:
        first = Sale.objects.filter(business=business).order_by('date').values_list('date', flat=True).first()
        start = first or end.replace(day=1)
    days = (end - start).days + 1
    granularity = 'day' if days <= 62 else 'month'

    def series(model, field):
        qs = model.objects.filter(business=business, date__gte=start, date__lte=end)
        if granularity == 'day':
            return {row['date']: row['s'] for row in qs.values('date').annotate(s=Sum(field))}
        return {row['m'].date() if hasattr(row['m'], 'date') else row['m']: row['s']
                for row in qs.annotate(m=TruncMonth('date')).values('m').annotate(s=Sum(field))}

    sales = series(Sale, 'total')
    purchases = series(Purchase, 'total')
    received = series(PaymentIn, 'amount')
    paid = series(PaymentOut, 'amount')

    buckets = []
    if granularity == 'day':
        cursor = start
        while cursor <= end:
            buckets.append((cursor, cursor.strftime('%d %b')))
            cursor += timedelta(days=1)
    else:
        cursor = date(start.year, start.month, 1)
        while cursor <= end:
            buckets.append((cursor, cursor.strftime('%b %Y')))
            cursor = add_months(cursor, 1)

    totals = {'sales': ZERO, 'purchases': ZERO, 'received': ZERO, 'paid': ZERO}
    rows = []
    for key, label in buckets:
        row = {
            'date': key, 'label': label,
            'sales': sales.get(key) or ZERO, 'purchases': purchases.get(key) or ZERO,
            'received': received.get(key) or ZERO, 'paid': paid.get(key) or ZERO,
        }
        for name in totals:
            totals[name] += row[name]
        rows.append({**row, **{name: money_str(row[name]) for name in totals}})
    return {
        'start': start, 'end': end, 'granularity': granularity, 'buckets': rows,
        'totals': {name: money_str(value) for name, value in totals.items()},
    }
