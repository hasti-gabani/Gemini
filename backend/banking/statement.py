"""Cash / bank account statements with running balance."""
from django.db.models import Sum

from core.dates import fmt_date, period_label
from core.exports import business_header, generated_at
from core.money import ZERO, q2
from ledger.models import BankTransaction

TYPE_LABELS = dict(BankTransaction.TYPE_CHOICES)


def opening_balance_on(account, start):
    """Balance at the start of `start` (before any transaction dated `start`)."""
    if not start:
        return account.opening_balance
    before = BankTransaction.objects.filter(account=account, date__lt=start).aggregate(
        i=Sum('amount_in'), o=Sum('amount_out'))
    return q2(account.opening_balance + (before['i'] or ZERO) - (before['o'] or ZERO))


def build_account_statement(account, start=None, end=None, direction=None, txn_type=None):
    opening = opening_balance_on(account, start)
    qs = BankTransaction.objects.filter(account=account).select_related('party')
    if start:
        qs = qs.filter(date__gte=start)
    if end:
        qs = qs.filter(date__lte=end)
    running = opening
    total_in = total_out = ZERO
    shown_in = shown_out = ZERO
    rows = []
    for txn in qs.order_by('date', 'source_created_at', 'id'):
        running += txn.amount_in - txn.amount_out
        total_in += txn.amount_in
        total_out += txn.amount_out
        if direction == 'in' and not txn.amount_in:
            continue
        if direction == 'out' and not txn.amount_out:
            continue
        if txn_type and txn.txn_type != txn_type:
            continue
        shown_in += txn.amount_in
        shown_out += txn.amount_out
        ref_type, ref_id = None, None
        if txn.payment_in_id:
            ref_type, ref_id = 'payment_in', txn.payment_in_id
        elif txn.payment_out_id:
            ref_type, ref_id = 'payment_out', txn.payment_out_id
        elif txn.adjustment_id:
            ref_type, ref_id = 'adjustment', txn.adjustment_id
        rows.append({
            'id': txn.id,
            'date': txn.date,
            'type': txn.txn_type,
            'type_label': TYPE_LABELS.get(txn.txn_type, txn.txn_type),
            'number': txn.number,
            'description': txn.description,
            'reference_no': txn.reference_no,
            'party': txn.party.name if txn.party_id else '',
            'party_id': txn.party_id,
            'amount_in': txn.amount_in,
            'amount_out': txn.amount_out,
            'balance': running,
            'ref_type': ref_type,
            'ref_id': ref_id,
        })
    return {
        'account': account,
        'start': start,
        'end': end,
        'period_label': period_label(start, end),
        'opening_balance': opening,
        'total_in': total_in,
        'total_out': total_out,
        'shown_in': shown_in,
        'shown_out': shown_out,
        'closing_balance': running,
        'rows': rows,
        'filtered': bool(direction or txn_type),
    }


def statement_json(statement):
    account = statement['account']
    money = ('amount_in', 'amount_out', 'balance')
    return {
        'account': {
            'id': account.id, 'kind': account.kind, 'name': account.name, 'bank_name': account.bank_name,
            'account_number': account.account_number, 'masked_number': account.masked_number,
            'ifsc': account.ifsc, 'current_balance': str(account.current_balance),
        },
        'start': statement['start'],
        'end': statement['end'],
        'period_label': statement['period_label'],
        'opening_balance': str(statement['opening_balance']),
        'total_in': str(statement['total_in']),
        'total_out': str(statement['total_out']),
        'shown_in': str(statement['shown_in']),
        'shown_out': str(statement['shown_out']),
        'closing_balance': str(statement['closing_balance']),
        'filtered': statement['filtered'],
        'results': [{**row, **{key: str(row[key]) for key in money}} for row in statement['rows']],
    }


def statement_report(statement, business, title=None):
    account = statement['account']
    info = [('Account', account.name)]
    if account.kind == account.KIND_BANK:
        if account.bank_name:
            info.append(('Bank', account.bank_name))
        if account.account_number:
            info.append(('Account No.', account.account_number))
        if account.ifsc:
            info.append(('IFSC', account.ifsc))
    single_day = statement['start'] and statement['start'] == statement['end']
    info.append(('Date' if single_day else 'Period', statement['period_label']))
    rows = [{
        'date': statement['start'], 'type': 'Opening Balance', 'description': '', 'reference_no': '',
        'amount_in': None, 'amount_out': None, 'balance': statement['opening_balance'],
    }]
    for row in statement['rows']:
        rows.append({
            'date': row['date'], 'type': row['type_label'], 'description': row['description'],
            'reference_no': row['reference_no'] or row['number'], 'amount_in': row['amount_in'] or None,
            'amount_out': row['amount_out'] or None, 'balance': row['balance'],
        })
    return {
        'title': title or ('Cash Report' if account.kind == account.KIND_CASH else 'Bank Statement'),
        'subtitle': f'{account.name} · {statement["period_label"]}',
        'business': business_header(business),
        'generated_at': generated_at(),
        'orientation': 'portrait',
        'info': info,
        'summary': [
            {'label': 'Opening Balance', 'value': statement['opening_balance'], 'type': 'money'},
            {'label': 'Money Received', 'value': statement['total_in'], 'type': 'money', 'tone': 'pos'},
            {'label': 'Money Paid', 'value': statement['total_out'], 'type': 'money', 'tone': 'neg'},
            {'label': 'Closing Balance', 'value': statement['closing_balance'], 'type': 'money'},
        ],
        'columns': [
            {'key': 'date', 'label': 'Date', 'type': 'date', 'width': 1.1},
            {'key': 'type', 'label': 'Type', 'type': 'text', 'width': 1.2},
            {'key': 'description', 'label': 'Description', 'type': 'multiline', 'width': 2.6},
            {'key': 'reference_no', 'label': 'Ref. No.', 'type': 'text', 'width': 1.1},
            {'key': 'amount_in', 'label': 'Credit (₹)', 'type': 'money', 'width': 1.2},
            {'key': 'amount_out', 'label': 'Debit (₹)', 'type': 'money', 'width': 1.2},
            {'key': 'balance', 'label': 'Balance (₹)', 'type': 'money', 'width': 1.3},
        ],
        'rows': rows,
        'totals': {'type': 'Total', 'amount_in': statement['shown_in'], 'amount_out': statement['shown_out'],
                   'balance': statement['closing_balance']},
        'notes': [],
        'filename': f'{account.name} - {fmt_date(statement["start"]) or "All"}'.replace('/', '-'),
    }
