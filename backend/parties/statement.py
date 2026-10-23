"""Party statement / ledger with opening balance and running balance."""
from collections import defaultdict

from django.db.models import Q, Sum

from core.dates import fmt_date, period_label
from core.exports import business_header, generated_at
from core.money import ZERO, fmt_money, q2
from ledger.models import LedgerEntry

TYPE_LABELS = dict(LedgerEntry.TYPE_CHOICES)


def balance_label(balance):
    if balance > 0:
        return 'Receivable'
    if balance < 0:
        return 'Payable'
    return 'Settled'


def build_statement(party, start=None, end=None):
    entries = LedgerEntry.objects.filter(party=party)
    opening_q = Q(entry_type=LedgerEntry.TYPE_OPENING)
    if start:
        opening_q |= Q(date__lt=start)
    if end:
        opening_q &= Q(date__lte=end)
    before = entries.filter(opening_q).aggregate(d=Sum('debit'), c=Sum('credit'))
    opening = q2((before['d'] or ZERO) - (before['c'] or ZERO))

    rows_qs = entries.exclude(entry_type=LedgerEntry.TYPE_OPENING)
    if start:
        rows_qs = rows_qs.filter(date__gte=start)
    if end:
        rows_qs = rows_qs.filter(date__lte=end)

    totals = defaultdict(lambda: ZERO)
    running = opening
    rows = []
    for entry in rows_qs.order_by('date', 'sort_order', 'source_created_at', 'id'):
        running += entry.debit - entry.credit
        totals['debit'] += entry.debit
        totals['credit'] += entry.credit
        if entry.entry_type == LedgerEntry.TYPE_SALE:
            totals['sales'] += entry.debit
        elif entry.entry_type == LedgerEntry.TYPE_PURCHASE:
            totals['purchases'] += entry.credit
        elif entry.entry_type == LedgerEntry.TYPE_PAYMENT_IN:
            totals['payments_in'] += entry.credit
        elif entry.entry_type == LedgerEntry.TYPE_PAYMENT_OUT:
            totals['payments_out'] += entry.debit
        ref_id = entry.sale_id or entry.purchase_id or entry.payment_in_id or entry.payment_out_id
        rows.append({
            'id': entry.id,
            'date': entry.date,
            'type': entry.entry_type,
            'type_label': TYPE_LABELS.get(entry.entry_type, entry.entry_type),
            'number': entry.number,
            'description': entry.description,
            'items': entry.items_summary,
            'qty': entry.qty_summary,
            'debit': entry.debit,
            'credit': entry.credit,
            'balance': running,
            'ref_type': entry.entry_type,
            'ref_id': ref_id,
        })
    closing = running
    return {
        'party': party,
        'start': start,
        'end': end,
        'period_label': period_label(start, end),
        'opening_balance': opening,
        'rows': rows,
        'totals': {
            'sales': totals['sales'],
            'purchases': totals['purchases'],
            'payments_in': totals['payments_in'],
            'payments_out': totals['payments_out'],
            'debit': totals['debit'],
            'credit': totals['credit'],
        },
        'closing_balance': closing,
        'closing_label': balance_label(closing),
    }


def statement_json(statement):
    party = statement['party']
    return {
        'party': {
            'id': party.id, 'name': party.name, 'phone': party.phone, 'address': party.full_address,
            'gstin': party.gstin, 'party_type': party.party_type, 'balance': str(party.balance),
        },
        'start': statement['start'],
        'end': statement['end'],
        'period_label': statement['period_label'],
        'opening_balance': str(statement['opening_balance']),
        'opening_label': balance_label(statement['opening_balance']),
        'rows': [{**row, 'debit': str(row['debit']), 'credit': str(row['credit']), 'balance': str(row['balance'])}
                 for row in statement['rows']],
        'totals': {key: str(value) for key, value in statement['totals'].items()},
        'closing_balance': str(statement['closing_balance']),
        'closing_label': statement['closing_label'],
    }


def statement_report(statement, business):
    """Shape a statement for core.pdf.render_report_pdf / core.excel.render_report_xlsx."""
    party = statement['party']
    is_supplier = party.party_type == party.TYPE_SUPPLIER
    info = [('Party', party.name)]
    if party.phone:
        info.append(('Mobile', party.phone))
    if party.full_address:
        info.append(('Address', party.full_address.replace('\n', ', ')))
    if party.gstin:
        info.append(('GSTIN', party.gstin))
    single_day = statement['start'] and statement['start'] == statement['end']
    info.append(('Date' if single_day else 'Period', statement['period_label']))

    totals = statement['totals']
    opening = statement['opening_balance']
    closing = statement['closing_balance']
    summary = [{'label': 'Opening Balance', 'value': opening, 'type': 'balance'}]
    if totals['sales'] or not is_supplier:
        summary.append({'label': 'Total Sales', 'value': totals['sales'], 'type': 'money'})
    if totals['payments_in'] or not is_supplier:
        summary.append({'label': 'Payments Received', 'value': totals['payments_in'], 'type': 'money', 'tone': 'pos'})
    if totals['purchases'] or is_supplier:
        summary.append({'label': 'Total Purchases', 'value': totals['purchases'], 'type': 'money'})
    if totals['payments_out'] or is_supplier:
        summary.append({'label': 'Payments Paid', 'value': totals['payments_out'], 'type': 'money'})
    pending_label = 'Total Pending (Receivable)' if closing >= 0 else 'Total Pending (Payable)'
    summary.append({'label': pending_label, 'value': abs(closing), 'type': 'money',
                    'tone': 'pos' if closing > 0 else 'neg' if closing < 0 else None})
    summary.append({'label': 'Closing Balance', 'value': closing, 'type': 'balance'})

    rows = [{
        'date': statement['start'],
        'type': 'Opening Balance',
        'number': '',
        'items': '',
        'qty': '',
        'debit': None,
        'credit': None,
        'balance': opening,
    }]
    for row in statement['rows']:
        rows.append({
            '_link': {'type': row['ref_type'], 'id': row['ref_id']} if row['ref_id'] else None,
            'date': row['date'],
            'type': row['type_label'],
            'number': row['number'],
            'items': row['items'],
            'qty': row['qty'],
            'debit': row['debit'],
            'credit': row['credit'],
            'balance': row['balance'],
        })
    closing_text = f'Closing Balance: {fmt_money(abs(closing))} ({statement["closing_label"]})'
    return {
        'title': 'Party Statement',
        'subtitle': f'{party.name} · {statement["period_label"]}',
        'business': business_header(business),
        'generated_at': generated_at(),
        'orientation': 'portrait',
        'info': info,
        'summary': summary,
        'columns': [
            {'key': 'date', 'label': 'Date', 'type': 'date', 'width': 1.1},
            {'key': 'type', 'label': 'Type', 'type': 'text', 'width': 1.2},
            {'key': 'number', 'label': 'Bill No.', 'type': 'text', 'width': 1.1},
            {'key': 'items', 'label': 'Item Name', 'type': 'multiline', 'width': 2.2},
            {'key': 'qty', 'label': 'Qty', 'type': 'multiline', 'width': 0.8},
            {'key': 'debit', 'label': 'Debit (₹)', 'type': 'money', 'width': 1.2},
            {'key': 'credit', 'label': 'Credit (₹)', 'type': 'money', 'width': 1.2},
            {'key': 'balance', 'label': 'Balance (₹)', 'type': 'balance', 'width': 1.5},
        ],
        'rows': rows,
        'totals': {'type': 'Total', 'debit': totals['debit'], 'credit': totals['credit'], 'balance': closing},
        'notes': [
            closing_text,
            'Dr = amount receivable from the party · Cr = amount payable to the party',
        ],
        'filename': f'Statement - {party.name} - {fmt_date(statement["start"]) or "All"}'.replace('/', '-'),
    }
