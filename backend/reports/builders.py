"""Report definitions and builders.

Every builder returns a dict in the render contract of core.pdf.render_report_pdf
and core.excel.render_report_xlsx (Decimal / date values). `report_json` turns it
into a JSON-safe payload for the browser. Rows may carry a `_link`
({'type': 'sale', 'id': 12}) so the UI can open the underlying record.
"""
from collections import OrderedDict
from datetime import date
from decimal import Decimal

from django.db.models import Count, F, Max, Min, Q, Sum
from django.db.models.functions import TruncMonth
from rest_framework.exceptions import NotFound

from banking.models import BankAccount
from banking.statement import build_account_statement
from banking.statement import statement_report as account_statement_report
from core.dates import fmt_date, parse_date, period_label, resolve_period, today
from core.exports import business_header, generated_at
from core.money import ZERO, fmt_qty, money_str, q2, qty_str
from inventory.models import Category, Item
from ledger.models import BankTransaction, LedgerEntry
from parties.models import Party
from parties.statement import build_statement
from parties.statement import statement_report as party_statement_report
from transactions.models import PaymentIn, PaymentOut, Purchase, PurchaseItem, Sale, SaleItem

REPORTS = OrderedDict()
JSON_ROW_LIMIT = 5000


def register(key, title, title_gu, group, filters, default_period='this_month', description=''):
    def decorator(builder):
        REPORTS[key] = {'key': key, 'title': title, 'title_gu': title_gu, 'group': group, 'filters': filters,
                        'default_period': default_period, 'description': description, 'builder': builder}
        return builder
    return decorator


def definitions():
    return [{k: v for k, v in definition.items() if k != 'builder'} for definition in REPORTS.values()]


def build_report(key, business, params):
    definition = REPORTS.get(key)
    if definition is None:
        raise NotFound('Report not found.')
    report = definition['builder'](business, params, definition)
    report['key'] = key
    report.pop('filename', None)
    return report


# --------------------------------------------------------------------------- helpers

def col(key, label, type='text', width=None):
    column = {'key': key, 'label': label, 'type': type}
    if width:
        column['width'] = width
    return column


def _range(params, definition):
    return resolve_period(params.get('period'), params.get('date_from'), params.get('date_to'),
                          default=definition['default_period'])


def _in_range(qs, start, end, field='date'):
    if start:
        qs = qs.filter(**{f'{field}__gte': start})
    if end:
        qs = qs.filter(**{f'{field}__lte': end})
    return qs


def _party(business, params):
    party_id = params.get('party')
    if not party_id:
        return None
    party = Party.objects.filter(business=business, id=party_id).first() if str(party_id).isdigit() else None
    if party is None:
        raise NotFound('The selected party was not found.')
    return party


def _account(business, params, kinds=(BankAccount.KIND_BANK, BankAccount.KIND_CASH)):
    account_id = params.get('account')
    if not account_id:
        return None
    account = BankAccount.objects.filter(business=business, id=account_id, kind__in=kinds).first() \
        if str(account_id).isdigit() else None
    if account is None:
        raise NotFound('The selected account was not found.')
    return account


def _subtitle(start, end, *extra):
    parts = [f'{"Date" if start and start == end else "Period"}: {period_label(start, end)}']
    parts += [part for part in extra if part]
    return ' · '.join(parts)


def _report(business, definition, *, subtitle, columns, rows, summary, totals=None, info=None, notes=None,
            orientation='portrait', title=None):
    return {
        'title': title or definition['title'],
        'subtitle': subtitle,
        'business': business_header(business),
        'generated_at': generated_at(),
        'orientation': orientation,
        'info': info or [],
        'summary': summary,
        'columns': columns,
        'rows': rows,
        'totals': totals,
        'notes': notes or [],
    }


def _money(label, value, tone=None):
    item = {'label': label, 'value': value or ZERO, 'type': 'money'}
    if tone:
        item['tone'] = tone  # 'pos' (money in, green) or 'neg' (money out / due, red)
    return item


def _number(label, value):
    return {'label': label, 'value': value or 0, 'type': 'number'}


def _items_text(bill):
    return '\n'.join(f'{line.name} × {fmt_qty(line.quantity)} {line.unit}'.strip() for line in bill.items.all())


STATUS_TEXT = {'paid': 'Paid', 'partial': 'Partial', 'unpaid': 'Unpaid'}


# --------------------------------------------------------------------------- day book

@register('day_book', 'Day Book', 'રોજમેળ', 'Day Book', ['date'], default_period='today',
          description='Every sale, purchase and payment of one day, with the money that came in and went out.')
def day_book_report(business, params, definition):
    """Money In / Money Out is money that actually moved on the day: a credit sale adds its
    total but no money in; the amount received (or paid) with a bill counts on that bill's row,
    later payments on their own rows. Cash <-> bank transfers are not listed."""
    day = parse_date(params.get('date'), 'date') or today()
    entries = []

    def with_bill(payment_model, origin_field, bills):
        return {row[f'{origin_field}_id']: row['s'] for row in payment_model.objects.filter(
            business=business, date=day, **{f'{origin_field}__in': bills}).values(f'{origin_field}_id').annotate(
            s=Sum('amount'))}

    sales = list(Sale.objects.filter(business=business, date=day))
    received_with = with_bill(PaymentIn, 'origin_sale', sales)
    for bill in sales:
        entries.append((bill.created_at, {
            '_link': {'type': 'sale', 'id': bill.id}, 'type': 'Sale', 'party': bill.party_name,
            'number': bill.number, 'total': bill.total, 'money_in': received_with.get(bill.id) or ZERO,
            'money_out': ZERO}))
    purchases = list(Purchase.objects.filter(business=business, date=day))
    paid_with = with_bill(PaymentOut, 'origin_purchase', purchases)
    for bill in purchases:
        entries.append((bill.created_at, {
            '_link': {'type': 'purchase', 'id': bill.id}, 'type': 'Purchase', 'party': bill.party_name,
            'number': bill.number, 'total': bill.total, 'money_in': ZERO,
            'money_out': paid_with.get(bill.id) or ZERO}))
    # Payments made with a bill of the same day are already on that bill's row.
    for payment in PaymentIn.objects.filter(business=business, date=day).exclude(origin_sale__date=day):
        entries.append((payment.created_at, {
            '_link': {'type': 'payment_in', 'id': payment.id}, 'type': 'Payment In', 'party': payment.party_name,
            'number': payment.number, 'total': payment.amount, 'money_in': payment.amount, 'money_out': ZERO}))
    for payment in PaymentOut.objects.filter(business=business, date=day).exclude(origin_purchase__date=day):
        entries.append((payment.created_at, {
            '_link': {'type': 'payment_out', 'id': payment.id}, 'type': 'Payment Out', 'party': payment.party_name,
            'number': payment.number, 'total': payment.amount, 'money_in': ZERO, 'money_out': payment.amount}))

    entries.sort(key=lambda entry: entry[0], reverse=True)  # newest first
    rows = [row for _, row in entries]
    money_in = sum((row['money_in'] for row in rows), ZERO)
    money_out = sum((row['money_out'] for row in rows), ZERO)
    net = money_in - money_out
    return _report(
        business, definition,
        subtitle=f'Date: {fmt_date(day)}',
        columns=[
            col('type', 'Type', 'text', 1.0), col('party', 'Name', 'text', 2.2), col('number', 'Ref No.', 'text', 1.0),
            col('total', 'Total (₹)', 'money', 1.2), col('money_in', 'Money In (₹)', 'money', 1.2),
            col('money_out', 'Money Out (₹)', 'money', 1.2),
        ],
        rows=rows,
        summary=[
            _money('Total', net),  # plain black: it is the day's net, not money in or out
            _money('Money In', money_in, 'pos'),
            _money('Money Out', money_out, 'neg'),
        ],
        totals={'type': 'Total', 'money_in': money_in, 'money_out': money_out},
        notes=['Total = Money In − Money Out. Money In / Money Out is money actually received or paid on this '
               'day; a credit bill shows its bill total with no money in or out. Transfers between cash and bank '
               'are not included.'],
    )


# --------------------------------------------------------------------------- sales / purchases

def _bills_report(business, params, definition, model):
    is_sale = model is Sale
    start, end = _range(params, definition)
    qs = _in_range(model.objects.filter(business=business), start, end)
    party = _party(business, params)
    if party:
        qs = qs.filter(party=party)
    status = params.get('status')
    if status in STATUS_TEXT:
        qs = qs.filter(payment_status=status)
    elif status == 'pending':
        qs = qs.filter(balance_due__gt=0)
    mode = params.get('mode')
    if mode in ('cash', 'credit'):
        qs = qs.filter(mode=mode)

    rows = []
    total = paid = pending = cash = credit = ZERO
    for bill in qs.prefetch_related('items').order_by('date', 'seq', 'id'):
        total += bill.total
        paid += bill.paid_amount
        pending += bill.balance_due
        if bill.mode == bill.MODE_CASH:
            cash += bill.total
        else:
            credit += bill.total
        rows.append({
            '_link': {'type': 'sale' if is_sale else 'purchase', 'id': bill.id},
            'date': bill.date, 'number': bill.number, 'party': bill.party_name, 'items': _items_text(bill),
            'mode': 'Cash' if bill.mode == bill.MODE_CASH else 'Credit', 'total': bill.total,
            'paid': bill.paid_amount, 'pending': bill.balance_due,
            'status': STATUS_TEXT.get(bill.payment_status, bill.payment_status),
        })
    party_word = 'Party' if is_sale else 'Supplier'
    summary = [
        _money('Total Sales' if is_sale else 'Total Purchases', total),
        _money('Total Received' if is_sale else 'Total Paid', paid, 'pos' if is_sale else None),
        _money('Total Pending', pending, 'neg'),
        _number('No. of Bills', len(rows)),
        _money('Cash ' + ('Sales' if is_sale else 'Purchases'), cash),
        _money('Credit ' + ('Sales' if is_sale else 'Purchases'), credit),
    ]
    return _report(
        business, definition,
        subtitle=_subtitle(start, end, f'{party_word}: {party.name}' if party else ''),
        orientation='landscape',
        columns=[
            col('date', 'Date', 'date', 1.0), col('number', 'Bill No.' if is_sale else 'Purchase No.', 'text', 1.0),
            col('party', party_word, 'text', 1.8), col('items', 'Items', 'multiline', 2.8),
            col('mode', 'Mode', 'text', 0.7), col('total', 'Total (₹)', 'money', 1.2),
            col('paid', ('Received' if is_sale else 'Paid') + ' (₹)', 'money', 1.2),
            col('pending', 'Pending (₹)', 'money', 1.2), col('status', 'Status', 'text', 0.8),
        ],
        rows=rows,
        summary=summary,
        totals={'date': None, 'number': 'Total', 'total': total, 'paid': paid, 'pending': pending},
    )


@register('sales', 'Total Sales Report', 'કુલ વેચાણ રિપોર્ટ', 'Sales', ['period', 'customer', 'status'],
          description='All sale bills with total, received and pending amounts.')
def sales_report(business, params, definition):
    return _bills_report(business, params, definition, Sale)


@register('purchases', 'Total Purchase Report', 'કુલ ખરીદી રિપોર્ટ', 'Purchase', ['period', 'supplier', 'status'],
          description='All purchase bills with total, paid and pending amounts.')
def purchases_report(business, params, definition):
    return _bills_report(business, params, definition, Purchase)


@register('daily_sales', 'Daily Sales Report', 'દૈનિક વેચાણ રિપોર્ટ', 'Sales', ['date'],
          description='Bills, cash vs credit sales and payments for one day.')
def daily_sales_report(business, params, definition):
    day = parse_date(params.get('date'), 'date') or today()
    bills = Sale.objects.filter(business=business, date=day).prefetch_related('items').order_by('seq', 'id')
    rows = []
    total = cash = credit = received = pending = ZERO
    for bill in bills:
        total += bill.total
        received += bill.paid_amount
        pending += bill.balance_due
        if bill.mode == bill.MODE_CASH:
            cash += bill.total
        else:
            credit += bill.total
        rows.append({
            '_link': {'type': 'sale', 'id': bill.id},
            'number': bill.number, 'party': bill.party_name, 'mode': 'Cash' if bill.mode == bill.MODE_CASH else 'Credit',
            'items': _items_text(bill), 'total': bill.total, 'received': bill.paid_amount, 'pending': bill.balance_due,
        })
    payments = PaymentIn.objects.filter(business=business, date=day).aggregate(s=Sum('amount'), c=Count('id'))
    return _report(
        business, definition,
        subtitle=f'Date: {fmt_date(day)}',
        columns=[
            col('number', 'Bill No.', 'text', 1.0), col('party', 'Party', 'text', 1.8),
            col('mode', 'Mode', 'text', 0.7), col('items', 'Items', 'multiline', 2.6),
            col('total', 'Total (₹)', 'money', 1.2), col('received', 'Received (₹)', 'money', 1.2),
            col('pending', 'Pending (₹)', 'money', 1.2),
        ],
        rows=rows,
        summary=[
            _number('Total Bills', len(rows)), _money('Total Sales', total), _money('Cash Sales', cash),
            _money('Credit Sales', credit), _money('Payments Received', payments['s'], 'pos'),
            _money('Pending Amount', pending, 'neg'),
        ],
        totals={'number': 'Total', 'total': total, 'received': received, 'pending': pending},
        notes=[f'Payments received on {fmt_date(day)} (all bills): {payments["c"]} payment(s).'],
        orientation='landscape',
    )


def _grouped_bills_report(business, params, definition, model):
    is_sale = model is Sale
    start, end = _range(params, definition)
    group = 'day' if params.get('group') == 'day' else 'month'
    qs = _in_range(model.objects.filter(business=business), start, end)
    if group == 'month':
        qs = qs.annotate(bucket=TruncMonth('date'))
    else:
        qs = qs.annotate(bucket=F('date'))
    grouped = qs.values('bucket').annotate(
        n_bills=Count('id'), s_total=Sum('total'), s_cash=Sum('total', filter=Q(mode='cash')),
        s_credit=Sum('total', filter=Q(mode='credit')), s_paid=Sum('paid_amount'), s_pending=Sum('balance_due'),
    ).order_by('bucket')
    rows = []
    totals = {'bills': 0, 'total': ZERO, 'cash': ZERO, 'credit': ZERO, 'paid': ZERO, 'pending': ZERO}
    sources = {'bills': 'n_bills', 'total': 's_total', 'cash': 's_cash', 'credit': 's_credit', 'paid': 's_paid',
               'pending': 's_pending'}
    for row in grouped:
        bucket = row['bucket']
        if hasattr(bucket, 'date') and not isinstance(bucket, date):
            bucket = bucket.date()
        values = {key: row[sources[key]] or (0 if key == 'bills' else ZERO) for key in totals}
        for key in totals:
            totals[key] += values[key]
        rows.append({'period': bucket.strftime('%B %Y') if group == 'month' else bucket, **values})
    word = 'Sales' if is_sale else 'Purchases'
    return _report(
        business, definition,
        subtitle=_subtitle(start, end, 'Month-wise' if group == 'month' else 'Day-wise'),
        columns=[
            col('period', 'Month' if group == 'month' else 'Date', 'text' if group == 'month' else 'date', 1.4),
            col('bills', 'Bills', 'number', 0.7), col('total', f'Total {word} (₹)', 'money', 1.3),
            col('cash', 'Cash (₹)', 'money', 1.2), col('credit', 'Credit (₹)', 'money', 1.2),
            col('paid', ('Received' if is_sale else 'Paid') + ' (₹)', 'money', 1.2),
            col('pending', 'Pending (₹)', 'money', 1.2),
        ],
        rows=rows,
        summary=[
            _money(f'Total {word}', totals['total']), _number('No. of Bills', totals['bills']),
            _money('Received' if is_sale else 'Paid', totals['paid'], 'pos' if is_sale else None),
            _money('Pending', totals['pending'], 'neg'),
        ],
        totals={'period': 'Total', **totals},
    )


@register('monthly_sales', 'Monthly Sales Report', 'માસિક વેચાણ રિપોર્ટ', 'Sales', ['period', 'group'],
          default_period='this_fy', description='Sales totals month-wise (or day-wise).')
def monthly_sales_report(business, params, definition):
    return _grouped_bills_report(business, params, definition, Sale)


@register('monthly_purchases', 'Monthly Purchase Report', 'માસિક ખરીદી રિપોર્ટ', 'Purchase', ['period', 'group'],
          default_period='this_fy', description='Purchase totals month-wise (or day-wise).')
def monthly_purchases_report(business, params, definition):
    return _grouped_bills_report(business, params, definition, Purchase)


# --------------------------------------------------------------------------- payments

def _payments_report(business, params, definition, model):
    is_in = model is PaymentIn
    start, end = _range(params, definition)
    qs = _in_range(model.objects.filter(business=business), start, end)
    party = _party(business, params)
    if party:
        qs = qs.filter(party=party)
    account = _account(business, params)
    if account:
        qs = qs.filter(account=account)
    bill_attr = 'sale' if is_in else 'purchase'
    rows = []
    total = cash = bank = ZERO
    for payment in qs.select_related('account').prefetch_related(f'allocations__{bill_attr}').order_by(
            'date', 'seq', 'id'):
        total += payment.amount
        if payment.account.kind == BankAccount.KIND_CASH:
            cash += payment.amount
        else:
            bank += payment.amount
        rows.append({
            '_link': {'type': 'payment_in' if is_in else 'payment_out', 'id': payment.id},
            'date': payment.date, 'number': payment.number, 'party': payment.party_name,
            'mode': payment.account.name, 'reference_no': payment.reference_no,
            'against': ', '.join(getattr(a, bill_attr).number for a in payment.allocations.all()),
            'amount': payment.amount,
        })
    party_word = 'Party' if is_in else 'Supplier'
    return _report(
        business, definition,
        subtitle=_subtitle(start, end, f'{party_word}: {party.name}' if party else '',
                           f'Account: {account.name}' if account else ''),
        orientation='landscape',
        columns=[
            col('date', 'Date', 'date', 1.0), col('number', 'Receipt No.' if is_in else 'Voucher No.', 'text', 1.1),
            col('party', party_word, 'text', 1.9), col('mode', 'Mode', 'text', 1.4),
            col('reference_no', 'Ref. No.', 'text', 1.2), col('against', 'Against Bills', 'multiline', 1.6),
            col('amount', 'Amount (₹)', 'money', 1.2),
        ],
        rows=rows,
        summary=[
            _money('Total Received' if is_in else 'Total Paid', total, 'pos' if is_in else 'neg'),
            _money('Cash', cash), _money('Bank', bank),
            _number('No. of Payments', len(rows)),
        ],
        totals={'number': 'Total', 'amount': total},
    )


@register('payments_in', 'Payment Received Report', 'ચુકવણી મળી રિપોર્ટ', 'Payments',
          ['period', 'customer', 'account'], description='Money received from parties.')
def payments_in_report(business, params, definition):
    return _payments_report(business, params, definition, PaymentIn)


@register('payments_out', 'Payment Paid Report', 'ચુકવણી કરી રિપોર્ટ', 'Payments',
          ['period', 'supplier', 'account'], description='Money paid to suppliers.')
def payments_out_report(business, params, definition):
    return _payments_report(business, params, definition, PaymentOut)


# --------------------------------------------------------------------------- cash & bank

def _link_for_bank_row(row):
    if row.get('ref_type') in ('payment_in', 'payment_out'):
        return {'type': row['ref_type'], 'id': row['ref_id']}
    return None


def _account_report(business, account, start, end, title):
    statement = build_account_statement(account, start, end)
    report = account_statement_report(statement, business, title=title)
    report.pop('filename', None)
    for row, source in zip(report['rows'][1:], statement['rows']):
        link = _link_for_bank_row(source)
        if link:
            row['_link'] = link
    return report


@register('bank', 'Bank Report', 'બેંક રિપોર્ટ', 'Cash & Bank', ['period', 'bank_account'],
          description='Opening, received, paid and closing balance per bank.')
def bank_report(business, params, definition):
    start, end = _range(params, definition)
    account = _account(business, params, kinds=(BankAccount.KIND_BANK,))
    if account:
        report = _account_report(business, account, start, end, 'Bank Report')
        report['summary'].insert(0, {'label': 'Bank Name', 'value': account.bank_name or account.name,
                                     'type': 'text'})
        return report
    rows = []
    totals = {'opening': ZERO, 'received': ZERO, 'paid': ZERO, 'closing': ZERO}
    for acc in BankAccount.objects.filter(business=business, kind=BankAccount.KIND_BANK).order_by('name'):
        statement = build_account_statement(acc, start, end)
        values = {'opening': statement['opening_balance'], 'received': statement['total_in'],
                  'paid': statement['total_out'], 'closing': statement['closing_balance']}
        for key in totals:
            totals[key] += values[key]
        rows.append({'_link': {'type': 'bank_account', 'id': acc.id}, 'name': acc.name, 'bank_name': acc.bank_name,
                     'account_number': acc.account_number, **values})
    return _report(
        business, definition,
        subtitle=_subtitle(start, end, 'All bank accounts'),
        columns=[
            col('name', 'Account', 'text', 1.8), col('account_number', 'Account No.', 'text', 1.3),
            col('opening', 'Opening (₹)', 'money', 1.2), col('received', 'Money Received (₹)', 'money', 1.3),
            col('paid', 'Money Paid (₹)', 'money', 1.3), col('closing', 'Closing (₹)', 'money', 1.2),
        ],
        rows=rows,
        summary=[
            _money('Opening Balance', totals['opening']), _money('Total Money Received', totals['received'], 'pos'),
            _money('Total Money Paid', totals['paid'], 'neg'), _money('Closing Balance', totals['closing']),
        ],
        totals={'name': 'Total', **totals},
    )


@register('cash', 'Cash Report', 'રોકડ રિપોર્ટ', 'Cash & Bank', ['period'],
          description='Cash in hand: opening, cash received, cash paid and closing.')
def cash_report(business, params, definition):
    from transactions.services import cash_account

    start, end = _range(params, definition)
    return _account_report(business, cash_account(business), start, end, 'Cash Report')


@register('bank_transactions', 'Bank Transaction Report', 'બેંક વ્યવહાર રિપોર્ટ', 'Cash & Bank',
          ['period', 'account', 'direction'], description='Every cash and bank movement in the period.')
def bank_transactions_report(business, params, definition):
    start, end = _range(params, definition)
    qs = _in_range(BankTransaction.objects.filter(business=business), start, end)
    account = _account(business, params)
    if account:
        qs = qs.filter(account=account)
    direction = params.get('direction')
    if direction == 'in':
        qs = qs.filter(amount_in__gt=0)
    elif direction == 'out':
        qs = qs.filter(amount_out__gt=0)
    labels = dict(BankTransaction.TYPE_CHOICES)
    rows = []
    money_in = money_out = ZERO
    for txn in qs.select_related('account').order_by('date', 'source_created_at', 'id'):
        money_in += txn.amount_in
        money_out += txn.amount_out
        row = {
            'date': txn.date, 'account': txn.account.name, 'type': labels.get(txn.txn_type, txn.txn_type),
            'description': txn.description, 'reference_no': txn.reference_no or txn.number,
            'amount_in': txn.amount_in or None, 'amount_out': txn.amount_out or None,
        }
        if txn.payment_in_id:
            row['_link'] = {'type': 'payment_in', 'id': txn.payment_in_id}
        elif txn.payment_out_id:
            row['_link'] = {'type': 'payment_out', 'id': txn.payment_out_id}
        rows.append(row)
    return _report(
        business, definition,
        subtitle=_subtitle(start, end, f'Account: {account.name}' if account else 'All accounts',
                           {'in': 'Money in only', 'out': 'Money out only'}.get(direction, '')),
        orientation='landscape',
        columns=[
            col('date', 'Date', 'date', 1.0), col('account', 'Account', 'text', 1.5), col('type', 'Type', 'text', 1.1),
            col('description', 'Description', 'multiline', 2.8), col('reference_no', 'Ref. No.', 'text', 1.1),
            col('amount_in', 'Money In (₹)', 'money', 1.2), col('amount_out', 'Money Out (₹)', 'money', 1.2),
        ],
        rows=rows,
        summary=[_money('Money In', money_in, 'pos'), _money('Money Out', money_out, 'neg'),
                 _money('Net', money_in - money_out,
                        'pos' if money_in > money_out else 'neg' if money_in < money_out else None),
                 _number('Transactions', len(rows))],
        totals={'date': None, 'account': 'Total', 'amount_in': money_in, 'amount_out': money_out},
    )


# --------------------------------------------------------------------------- party statements

def _party_statement_report(business, params, definition, side):
    start, end = _range(params, definition)
    party = _party(business, params)
    word = 'Party' if side == 'customer' else 'Supplier'
    if party:
        report = party_statement_report(build_statement(party, start, end), business)
        report['title'] = f'{word} Statement'
        report.pop('filename', None)
        return report

    types = [Party.TYPE_CUSTOMER, Party.TYPE_BOTH] if side == 'customer' else [Party.TYPE_SUPPLIER, Party.TYPE_BOTH]
    parties = {p.id: p for p in Party.objects.filter(business=business, party_type__in=types)}
    entries = LedgerEntry.objects.filter(party_id__in=parties.keys())
    before_q = Q(entry_type=LedgerEntry.TYPE_OPENING)
    if start:
        before_q |= Q(date__lt=start)
    if end:
        before_q &= Q(date__lte=end)
    opening = {row['party_id']: (row['d'] or ZERO) - (row['c'] or ZERO)
               for row in entries.filter(before_q).values('party_id').annotate(d=Sum('debit'), c=Sum('credit'))}
    period_qs = _in_range(entries.exclude(entry_type=LedgerEntry.TYPE_OPENING), start, end)
    movement = {row['party_id']: row for row in period_qs.values('party_id').annotate(
        d=Sum('debit'), c=Sum('credit'),
        sales=Sum('debit', filter=Q(entry_type=LedgerEntry.TYPE_SALE)),
        received=Sum('credit', filter=Q(entry_type=LedgerEntry.TYPE_PAYMENT_IN)),
        purchases=Sum('credit', filter=Q(entry_type=LedgerEntry.TYPE_PURCHASE)),
        paid=Sum('debit', filter=Q(entry_type=LedgerEntry.TYPE_PAYMENT_OUT)))}

    rows = []
    totals = {'opening': ZERO, 'bills': ZERO, 'payments': ZERO, 'closing': ZERO}
    for party_id, p in sorted(parties.items(), key=lambda kv: kv[1].name.lower()):
        open_bal = opening.get(party_id, ZERO)
        move = movement.get(party_id) or {}
        debit, credit = move.get('d') or ZERO, move.get('c') or ZERO
        bills = (move.get('sales') if side == 'customer' else move.get('purchases')) or ZERO
        payments = (move.get('received') if side == 'customer' else move.get('paid')) or ZERO
        closing = open_bal + debit - credit
        if not (open_bal or debit or credit):
            continue
        for key, value in (('opening', open_bal), ('bills', bills), ('payments', payments), ('closing', closing)):
            totals[key] += value
        rows.append({'_link': {'type': 'party', 'id': party_id}, 'name': p.name, 'phone': p.phone,
                     'opening': open_bal, 'bills': bills, 'payments': payments, 'closing': closing})
    is_customer = side == 'customer'
    return _report(
        business, definition,
        subtitle=_subtitle(start, end, f'All {word.lower()}s'),
        columns=[
            col('name', word, 'text', 2.2), col('phone', 'Mobile', 'text', 1.2),
            col('opening', 'Opening (₹)', 'balance', 1.4),
            col('bills', ('Sales' if is_customer else 'Purchases') + ' (₹)', 'money', 1.3),
            col('payments', ('Received' if is_customer else 'Paid') + ' (₹)', 'money', 1.3),
            col('closing', 'Closing (₹)', 'balance', 1.4),
        ],
        rows=rows,
        summary=[
            {'label': 'Opening Balance', 'value': totals['opening'], 'type': 'balance'},
            _money('Total Sales' if is_customer else 'Total Purchases', totals['bills']),
            _money('Total Received' if is_customer else 'Total Paid', totals['payments'],
                   'pos' if is_customer else None),
            {'label': 'Closing Balance', 'value': totals['closing'], 'type': 'balance'},
        ],
        totals={'name': 'Total', **totals},
        notes=['Dr = receivable (you will get) · Cr = payable (you will give). '
               'Closing balance includes every sale, purchase and payment with the party.'],
    )


@register('customer_statement', 'Party-wise Statement', 'પાર્ટી મુજબ સ્ટેટમેન્ટ', 'Parties',
          ['period', 'customer'], description='Ledger for one party, or balances of all parties.')
def customer_statement_report(business, params, definition):
    return _party_statement_report(business, params, definition, 'customer')


@register('supplier_statement', 'Supplier-wise Statement', 'સપ્લાયર મુજબ સ્ટેટમેન્ટ', 'Parties',
          ['period', 'supplier'], description='Ledger for one supplier, or balances of all suppliers.')
def supplier_statement_report(business, params, definition):
    return _party_statement_report(business, params, definition, 'supplier')


def _pending_report(business, params, definition, side):
    is_receivable = side == 'receivable'
    bill_model = Sale if is_receivable else Purchase
    t = today()
    word = 'Party' if is_receivable else 'Supplier'
    view = 'bill' if params.get('view') == 'bill' else 'party'
    if view == 'bill':
        qs = bill_model.objects.filter(business=business, balance_due__gt=0).order_by('date', 'id')
        party = _party(business, params)
        if party:
            qs = qs.filter(party=party)
        rows = []
        total = paid = pending = overdue = ZERO
        for bill in qs:
            days = (t - bill.due_date).days if bill.due_date and bill.due_date < t else 0
            total += bill.total
            paid += bill.paid_amount
            pending += bill.balance_due
            if days:
                overdue += bill.balance_due
            rows.append({'_link': {'type': 'sale' if is_receivable else 'purchase', 'id': bill.id},
                         'date': bill.date, 'number': bill.number, 'party': bill.party_name,
                         'due_date': bill.due_date, 'overdue_days': days, 'total': bill.total,
                         'paid': bill.paid_amount, 'pending': bill.balance_due})
        return _report(
            business, definition,
            subtitle=f'As on {fmt_date(t)} · Bill-wise',
            orientation='landscape',
            columns=[
                col('date', 'Date', 'date', 1.0), col('number', 'Bill No.', 'text', 1.0),
                col('party', word, 'text', 2.0), col('due_date', 'Due Date', 'date', 1.0),
                col('overdue_days', 'Days Overdue', 'number', 0.9), col('total', 'Total (₹)', 'money', 1.2),
                col('paid', ('Received' if is_receivable else 'Paid') + ' (₹)', 'money', 1.2),
                col('pending', 'Pending (₹)', 'money', 1.2),
            ],
            rows=rows,
            summary=[_money('Total Pending', pending, 'pos' if is_receivable else 'neg'),
                     _money('Overdue', overdue, 'neg'), _number('Pending Bills', len(rows))],
            totals={'number': 'Total', 'total': total, 'paid': paid, 'pending': pending},
        )

    balance_filter = Q(balance__gt=0) if is_receivable else Q(balance__lt=0)
    parties = Party.objects.filter(business=business).filter(balance_filter)
    stats = {row['party_id']: row for row in bill_model.objects.filter(
        business=business, balance_due__gt=0, party__isnull=False).values('party_id').annotate(
        count=Count('id'), oldest=Min('date'), last=Max('date'),
        overdue=Sum('balance_due', filter=Q(due_date__lt=t)))}
    rows = []
    total = overdue_total = ZERO
    for p in parties.order_by('-balance' if is_receivable else 'balance'):
        amount = abs(p.balance)
        stat = stats.get(p.id) or {}
        total += amount
        overdue_total += stat.get('overdue') or ZERO
        rows.append({'_link': {'type': 'party', 'id': p.id}, 'name': p.name, 'phone': p.phone,
                     'bills': stat.get('count') or 0, 'oldest': stat.get('oldest'),
                     'last_txn': p.last_txn_date, 'overdue': stat.get('overdue') or ZERO, 'balance': amount})
    return _report(
        business, definition,
        subtitle=f'As on {fmt_date(t)} · Party-wise',
        columns=[
            col('name', word, 'text', 2.2), col('phone', 'Mobile', 'text', 1.2), col('bills', 'Pending Bills', 'number', 0.9),
            col('oldest', 'Oldest Bill', 'date', 1.0), col('last_txn', 'Last Transaction', 'date', 1.1),
            col('overdue', 'Overdue (₹)', 'money', 1.2),
            col('balance', ('Receivable' if is_receivable else 'Payable') + ' (₹)', 'money', 1.3),
        ],
        rows=rows,
        summary=[
            _money('Total Receivable (મારે લેવાના)' if is_receivable else 'Total Payable (મારે આપવાના)', total,
                   'pos' if is_receivable else 'neg'),
            _money('Overdue Amount', overdue_total, 'neg'), _number(f'{word}s', len(rows)),
        ],
        totals={'name': 'Total', 'overdue': overdue_total, 'balance': total},
    )


@register('receivables', 'Pending Receivable Report', 'બાકી લેણાં રિપોર્ટ', 'Parties', ['view', 'customer'],
          default_period='all', description='Who owes you money, party-wise or bill-wise.')
def receivables_report(business, params, definition):
    return _pending_report(business, params, definition, 'receivable')


@register('payables', 'Pending Payable Report', 'બાકી દેવાં રિપોર્ટ', 'Parties', ['view', 'supplier'],
          default_period='all', description='Whom you owe money, party-wise or bill-wise.')
def payables_report(business, params, definition):
    return _pending_report(business, params, definition, 'payable')


# --------------------------------------------------------------------------- items

def _item_report(business, params, definition, line_model):
    is_sale = line_model is SaleItem
    fk = 'sale' if is_sale else 'purchase'
    start, end = _range(params, definition)
    lines = line_model.objects.filter(**{f'{fk}__business': business})
    lines = _in_range(lines, start, end, field=f'{fk}__date')
    party = _party(business, params)
    if party:
        lines = lines.filter(**{f'{fk}__party': party})
    category = params.get('category')
    if category and str(category).isdigit():
        lines = lines.filter(item__category_id=category)

    rows = []
    items = {i.id: i for i in Item.objects.filter(business=business)}
    for row in lines.filter(item__isnull=False).values('item_id').annotate(
            qty=Sum('quantity'), amount=Sum('amount'), taxable=Sum('taxable_amount'),
            bills=Count(fk, distinct=True)):
        item = items.get(row['item_id'])
        rows.append({'_link': {'type': 'item', 'id': row['item_id']}, 'name': item.name if item else '',
                     'code': item.code if item else '', 'unit': item.unit if item else '', 'qty': row['qty'],
                     'amount': row['amount'], 'taxable': row['taxable'], 'bills': row['bills']})
    if not category:
        for row in lines.filter(item__isnull=True).values('name', 'unit').annotate(
                qty=Sum('quantity'), amount=Sum('amount'), taxable=Sum('taxable_amount'),
                bills=Count(fk, distinct=True)):
            rows.append({'name': row['name'], 'code': '', 'unit': row['unit'], 'qty': row['qty'],
                         'amount': row['amount'], 'taxable': row['taxable'], 'bills': row['bills']})
    total_qty = total_amount = ZERO
    for row in rows:
        row['avg_rate'] = q2(row['taxable'] / row['qty']) if row['qty'] else ZERO
        total_qty += row['qty']
        total_amount += row['amount']
    rows.sort(key=lambda r: r['amount'], reverse=True)
    word = 'Sold' if is_sale else 'Purchased'
    return _report(
        business, definition,
        subtitle=_subtitle(start, end, f'Party: {party.name}' if party else '',
                           f'Category: {Category.objects.filter(id=category).values_list("name", flat=True).first()}'
                           if category and str(category).isdigit() else ''),
        columns=[
            col('name', 'Item', 'text', 2.4), col('code', 'Code', 'text', 0.9), col('unit', 'Unit', 'text', 0.7),
            col('qty', f'Qty {word}', 'qty', 1.0), col('avg_rate', 'Avg. Rate (₹)', 'money', 1.1),
            col('amount', 'Amount (₹)', 'money', 1.3), col('bills', 'Bills', 'number', 0.7),
        ],
        rows=rows,
        summary=[_money('Total Amount', total_amount), {'label': f'Total Qty {word}', 'value': total_qty, 'type': 'qty'},
                 _number('Items', len(rows))],
        totals={'name': 'Total', 'qty': total_qty, 'amount': total_amount},
        notes=['Avg. rate is before tax, after discount.'],
    )


@register('item_sales', 'Item-wise Sales Report', 'વસ્તુ મુજબ વેચાણ રિપોર્ટ', 'Items',
          ['period', 'customer', 'category'], description='Quantity and value sold per item.')
def item_sales_report(business, params, definition):
    return _item_report(business, params, definition, SaleItem)


@register('item_purchases', 'Item-wise Purchase Report', 'વસ્તુ મુજબ ખરીદી રિપોર્ટ', 'Items',
          ['period', 'supplier', 'category'], description='Quantity and value purchased per item.')
def item_purchases_report(business, params, definition):
    return _item_report(business, params, definition, PurchaseItem)


@register('stock_summary', 'Stock Summary Report', 'સ્ટોક સમરી રિપોર્ટ', 'Items', ['category', 'stock'],
          default_period='all', description='Current stock, sold and purchased quantity and stock value.')
def stock_summary_report(business, params, definition):
    qs = Item.objects.filter(business=business).select_related('category').order_by('name')
    category = params.get('category')
    if category and str(category).isdigit():
        qs = qs.filter(category_id=category)
    stock = params.get('stock')
    if stock == 'low':
        qs = qs.filter(track_stock=True, low_stock_limit__gt=0, current_stock__lte=F('low_stock_limit'))
    elif stock == 'out':
        qs = qs.filter(track_stock=True, current_stock__lte=0)
    rows = []
    value_total = ZERO
    low = out = 0
    for item in qs:
        value = q2(max(item.current_stock, ZERO) * item.purchase_price) if item.track_stock else ZERO
        value_total += value
        if item.is_low_stock:
            low += 1
        if item.track_stock and item.current_stock <= 0:
            out += 1
        rows.append({
            '_link': {'type': 'item', 'id': item.id}, 'name': item.name, 'code': item.code,
            'category': item.category.name if item.category else '', 'unit': item.unit,
            'opening': item.opening_stock, 'purchased': item.purchased_qty, 'sold': item.sold_qty,
            'stock': item.current_stock, 'low_limit': item.low_stock_limit or None,
            'purchase_price': item.purchase_price, 'value': value,
            'status': 'Out of stock' if item.track_stock and item.current_stock <= 0
            else 'Low stock' if item.is_low_stock else '',
        })
    return _report(
        business, definition,
        subtitle=f'As on {fmt_date(today())}',
        orientation='landscape',
        columns=[
            col('name', 'Item', 'text', 2.2), col('code', 'Code', 'text', 0.8), col('category', 'Category', 'text', 1.1),
            col('unit', 'Unit', 'text', 0.6), col('opening', 'Opening', 'qty', 0.8),
            col('purchased', 'Purchased', 'qty', 0.9), col('sold', 'Sold', 'qty', 0.8),
            col('stock', 'Current Stock', 'qty', 1.0), col('low_limit', 'Low Limit', 'qty', 0.8),
            col('purchase_price', 'Purchase Price (₹)', 'money', 1.1), col('value', 'Stock Value (₹)', 'money', 1.2),
            col('status', 'Status', 'text', 0.9),
        ],
        rows=rows,
        summary=[_number('Items', len(rows)), _money('Stock Value', value_total), _number('Low Stock', low),
                 _number('Out of Stock', out)],
        totals={'name': 'Total', 'value': value_total},
    )


# --------------------------------------------------------------------------- JSON

def _jsonable(value, kind=None):
    if isinstance(value, Decimal):
        # aggregates from the database are not always scaled, so quantize by column type
        return qty_str(value) if kind == 'qty' else money_str(value) if kind in ('money', 'balance') else str(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def report_json(report, definition=None):
    rows = report['rows']
    truncated = len(rows) > JSON_ROW_LIMIT
    business = dict(report['business'])
    business.pop('logo_path', None)
    types = {column['key']: column['type'] for column in report['columns']}
    return {
        'key': report.get('key'),
        'title': report['title'],
        'subtitle': report['subtitle'],
        'business': business,
        'generated_at': report['generated_at'],
        'info': [{'label': label, 'value': value} for label, value in report.get('info') or []],
        'summary': [{**item, 'value': _jsonable(item['value'], item.get('type'))} for item in report['summary']],
        'columns': report['columns'],
        'rows': [{key: _jsonable(value, types.get(key)) for key, value in row.items()}
                 for row in rows[:JSON_ROW_LIMIT]],
        'row_count': len(rows),
        'truncated': truncated,
        'totals': {key: _jsonable(value, types.get(key))
                   for key, value in (report.get('totals') or {}).items()} or None,
        'notes': report.get('notes') or [],
        'definition': {k: v for k, v in definition.items() if k != 'builder'} if definition else None,
    }
