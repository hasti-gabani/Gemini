"""Display-ready invoice / receipt documents.

One builder feeds every output — PDF (core.pdf), the in-app print preview and
Bluetooth receipt (JSON), the public share page and WhatsApp text — so they
always show identical figures.
"""
from collections import OrderedDict

from django.utils import timezone

from core.dates import fmt_date
from core.exports import business_header
from core.money import ZERO, amount_in_words, fmt_money, fmt_qty

from .models import PaymentIn, Sale

STATUS_LABELS = {'paid': 'PAID', 'partial': 'PARTIALLY PAID', 'unpaid': 'UNPAID'}


def _header(business):
    """Business block on bills and receipts: the name (and logo / GSTIN when set), no address, phone or email."""
    return {**business_header(business), 'address': '', 'phone': '', 'email': ''}


def _time(moment):
    """Time the bill or payment was made, e.g. 4:45 PM."""
    return timezone.localtime(moment).strftime('%I:%M %p').lstrip('0') if moment else ''


def _plain(value):
    return fmt_money(value, symbol='')


def _pct(value):
    text = f'{value:f}'
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return f'{text}%'


def _bank_details(business):
    from banking.models import BankAccount

    account = (BankAccount.objects.filter(business=business, kind=BankAccount.KIND_BANK, print_on_invoice=True,
                                          is_active=True).order_by('-is_default', 'id').first())
    if account is None:
        return None
    return {'bank_name': account.bank_name or account.name, 'account_name': account.account_name,
            'account_number': account.account_number, 'ifsc': account.ifsc, 'branch': account.branch,
            'upi_id': account.upi_id}


def _party_balances(bill, is_sale):
    """Previous / Current Balance of the bill's party, as on Vyapar invoices.

    Current = the party's balance now; Previous = that minus what this bill still
    leaves pending. Amounts on the usual side (receivable for a sale, payable for a
    purchase) print plain; the other side gets a (Receivable) / (Payable) tag.
    """
    party = bill.party
    if party is None:
        return []
    current = party.balance
    previous = current - (bill.balance_due if is_sale else -bill.balance_due)

    def show(balance):
        if balance == 0 or (balance > 0) == is_sale:
            return fmt_money(abs(balance))
        return f'{fmt_money(abs(balance))} ({"Receivable" if balance > 0 else "Payable"})'

    return [{'label': 'Previous Balance', 'value': show(previous)},
            {'label': 'Current Balance', 'value': show(current)}]


def bill_document(bill):
    is_sale = isinstance(bill, Sale)
    business = bill.business
    settings = business.settings
    lines = list(bill.items.all())

    show_tax = settings.tax_enabled and any(line.tax_rate > 0 for line in lines)
    columns = {
        'hsn': any(line.hsn for line in lines),
        'discount': any(line.discount_amount > 0 for line in lines),
        'tax': show_tax,
    }
    items = []
    tax_groups = OrderedDict()
    total_qty = ZERO
    for index, line in enumerate(lines, start=1):
        total_qty += line.quantity
        tax_label = ''
        if line.tax_rate > 0:
            tax_label = _pct(line.tax_rate) + (' incl.' if line.tax_inclusive else '')
            group = tax_groups.setdefault(line.tax_rate, {'taxable': ZERO, 'tax': ZERO})
            group['taxable'] += line.taxable_amount
            group['tax'] += line.tax_amount
        items.append({
            'sno': index,
            'name': line.name,
            'description': f'Code: {line.code}' if line.code else '',
            'hsn': line.hsn,
            'qty': fmt_qty(line.quantity),
            'unit': line.unit,
            'rate': _plain(line.rate),
            'discount': _plain(line.discount_amount) if line.discount_amount > 0 else '',
            'discount_label': _pct(line.discount_percent) if line.discount_percent > 0 else '',
            'tax_label': tax_label,
            'tax': _plain(line.tax_amount) if line.tax_amount > 0 else '',
            'amount': _plain(line.amount),
        })

    summary = []
    if lines:
        summary.append({'label': 'Subtotal', 'value': fmt_money(bill.subtotal)})
        if bill.item_discount > 0:
            summary.append({'label': 'Item Discount', 'value': '- ' + fmt_money(bill.item_discount)})
        if bill.tax_total > 0:
            summary.append({'label': settings.tax_label or 'Tax', 'value': fmt_money(bill.tax_total)})
        if bill.discount_amount > 0:
            label = 'Discount' + (f' ({_pct(bill.discount_percent)})' if bill.discount_percent > 0 else '')
            summary.append({'label': label, 'value': '- ' + fmt_money(bill.discount_amount)})
        if bill.charges_amount > 0:
            summary.append({'label': bill.charges_label or 'Other Charges', 'value': fmt_money(bill.charges_amount)})
        if bill.round_off:
            sign = '- ' if bill.round_off < 0 else '+ '
            summary.append({'label': 'Round Off', 'value': sign + fmt_money(abs(bill.round_off))})

    payments = []
    for allocation in bill.allocations.select_related('payment__account').order_by('payment__date', 'payment_id'):
        payment = allocation.payment
        payments.append({'number': payment.number, 'date': fmt_date(payment.date), 'mode': payment.account.name,
                         'amount': fmt_money(allocation.amount)})

    meta = [('Estimate No.' if is_sale else 'Bill No.', bill.number), ('Date', fmt_date(bill.date))]
    if bill.due_date and bill.balance_due > 0:
        meta.append(('Due Date', fmt_date(bill.due_date)))
    meta.append(('Time', _time(bill.created_at)))

    title = (settings.invoice_title or 'Invoice').upper() if is_sale else 'PURCHASE BILL'
    return {
        'doc_type': 'sale' if is_sale else 'purchase',
        'title': title,
        'business': _header(business),
        'party_label': 'Bill To' if is_sale else 'Supplier',
        'party': {'name': bill.party_name, 'phone': bill.party_phone, 'address': bill.party_address,
                  'gstin': bill.party_gstin if settings.show_gst else ''},
        'meta': meta,
        'status': bill.payment_status,
        'status_label': STATUS_LABELS.get(bill.payment_status, bill.payment_status.upper()),
        'columns': columns,
        'items': items,
        'total_qty': fmt_qty(total_qty),
        'summary': summary,
        'total': fmt_money(bill.total),
        'paid_label': 'Received' if is_sale else 'Paid',
        'paid': fmt_money(bill.paid_amount),
        'balance_label': 'Balance Due',
        'balance': fmt_money(bill.balance_due),
        'party_balances': _party_balances(bill, is_sale),
        'amount_in_words': amount_in_words(bill.total) if settings.show_amount_in_words else '',
        'payments': payments,
        'notes': bill.notes if settings.show_description else '',
        'terms': bill.terms if settings.show_terms else '',
        'bank': _bank_details(business) if is_sale and settings.show_bank_details else None,
        'show_signature': settings.show_signature,
        'footer_note': settings.footer_note,
        'tax_summary': [
            {'rate': _pct(rate), 'taxable': fmt_money(group['taxable']), 'tax': fmt_money(group['tax'])}
            for rate, group in tax_groups.items()
        ] if show_tax else [],
    }


def payment_document(payment):
    is_in = isinstance(payment, PaymentIn)
    business = payment.business
    settings = business.settings
    bill_attr = 'sale' if is_in else 'purchase'
    allocations = []
    for allocation in payment.allocations.select_related(bill_attr).order_by(f'{bill_attr}__date'):
        bill = getattr(allocation, bill_attr)
        allocations.append({'number': bill.number, 'date': fmt_date(bill.date), 'bill_total': fmt_money(bill.total),
                            'amount': fmt_money(allocation.amount)})
    meta = [('Receipt No.' if is_in else 'Voucher No.', payment.number), ('Date', fmt_date(payment.date)),
            ('Time', _time(payment.created_at))]
    if payment.reference_no:
        meta.append(('Reference No.', payment.reference_no))
    party = payment.party
    unallocated = payment.amount - payment.allocated_amount
    party_balance_label = party_balance = ''
    if party is not None:
        balance = party.balance
        party_balance_label = 'Current Balance'
        state = 'Receivable' if balance > 0 else 'Payable' if balance < 0 else 'Settled'
        party_balance = f'{fmt_money(abs(balance))} ({state})'
    return {
        'doc_type': 'payment_in' if is_in else 'payment_out',
        'title': 'PAYMENT RECEIPT' if is_in else 'PAYMENT VOUCHER',
        'business': _header(business),
        'party_label': 'Received From' if is_in else 'Paid To',
        'party': {'name': payment.party_name or (party.name if party else ''),
                  'phone': party.phone if party else '', 'address': party.full_address if party else '',
                  'gstin': party.gstin if party and settings.show_gst else ''},
        'meta': meta,
        'amount': fmt_money(payment.amount),
        'amount_in_words': amount_in_words(payment.amount),
        'allocations': allocations,
        'unallocated_label': ('Advance / not linked to a bill' if unallocated > 0 else ''),
        'unallocated': fmt_money(unallocated) if unallocated > 0 else '',
        'party_balance_label': party_balance_label,
        'party_balance': party_balance,
        'notes': payment.notes,
        'show_signature': settings.show_signature,
        'footer_note': settings.footer_note,
    }


def document_json(doc, logo_url=None):
    """JSON-safe copy for the browser (never exposes filesystem paths)."""
    data = dict(doc)
    business = dict(doc['business'])
    has_logo = bool(business.pop('logo_path', None))
    business['logo_url'] = logo_url if has_logo else None
    data['business'] = business
    data['meta'] = [{'label': label, 'value': value} for label, value in doc['meta']]
    return data


def bill_share_text(bill, url=None):
    is_sale = isinstance(bill, Sale)
    lines = [f'*{bill.business.name}*',
             f'{"Invoice" if is_sale else "Purchase bill"} {bill.number} · {fmt_date(bill.date)}']
    if bill.party_name:
        lines.append(f'{"Party" if is_sale else "Supplier"}: {bill.party_name}')
    lines.append(f'Total: {fmt_money(bill.total)}')
    if bill.paid_amount > 0:
        lines.append(f'{"Received" if is_sale else "Paid"}: {fmt_money(bill.paid_amount)}')
    if bill.balance_due > 0:
        lines.append(f'*Balance Due: {fmt_money(bill.balance_due)}*')
        if bill.due_date:
            lines.append(f'Due Date: {fmt_date(bill.due_date)}')
    else:
        lines.append('Status: PAID')
    if url:
        lines.append(f'\nView / download bill: {url}')
    footer = bill.business.settings.footer_note
    if footer:
        lines.append(f'\n{footer}')
    return '\n'.join(lines)


def payment_share_text(payment, url=None):
    is_in = isinstance(payment, PaymentIn)
    lines = [f'*{payment.business.name}*',
             f'{"Payment receipt" if is_in else "Payment voucher"} {payment.number} · {fmt_date(payment.date)}',
             f'{"Received from" if is_in else "Paid to"}: {payment.party_name}',
             f'Amount: *{fmt_money(payment.amount)}*',
             f'Mode: {payment.account.name}']
    if payment.reference_no:
        lines.append(f'Ref. No.: {payment.reference_no}')
    if url:
        lines.append(f'\nView / download: {url}')
    lines.append('\nThank you!')
    return '\n'.join(lines)
