"""Business logic for sales, purchases and payments.

All writes go through these functions so the ledger, cash/bank balances,
stock, bill payment status and party balances are always recalculated in the
same database transaction.
"""
from dataclasses import dataclass

from django.db import transaction
from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from core.money import ZERO, fmt_money, q2
from ledger import balances, posting

from . import numbering
from .calc import calc_bill, calc_line
from .models import (
    Attachment, PaymentIn, PaymentOut, Purchase, PurchaseAllocation, PurchaseItem, Sale, SaleAllocation, SaleItem,
)


@dataclass(frozen=True)
class BillKind:
    key: str
    label: str
    party_label: str
    model: type
    line_model: type
    line_fk: str
    payment_model: type
    payment_doc: str
    allocation_model: type
    allocation_fk: str
    origin_field: str
    attachment_field: str
    post_bill: callable
    post_payment: callable
    recalc_bills: callable
    recalc_payments: callable


@dataclass(frozen=True)
class PaymentKind:
    key: str
    label: str
    party_label: str
    model: type
    doc_type: str
    bill_model: type
    bill_label: str
    allocation_model: type
    allocation_fk: str
    origin_field: str
    attachment_field: str
    post_payment: callable
    recalc_bills: callable
    recalc_payments: callable


SALE = BillKind(
    key='sale', label='Bill', party_label='party', model=Sale, line_model=SaleItem, line_fk='sale',
    payment_model=PaymentIn, payment_doc='payment_in', allocation_model=SaleAllocation, allocation_fk='sale',
    origin_field='origin_sale', attachment_field='sale', post_bill=posting.post_sale,
    post_payment=posting.post_payment_in, recalc_bills=balances.recalc_sales,
    recalc_payments=balances.recalc_payments_in,
)
PURCHASE = BillKind(
    key='purchase', label='Purchase bill', party_label='supplier', model=Purchase, line_model=PurchaseItem,
    line_fk='purchase', payment_model=PaymentOut, payment_doc='payment_out', allocation_model=PurchaseAllocation,
    allocation_fk='purchase', origin_field='origin_purchase', attachment_field='purchase',
    post_bill=posting.post_purchase, post_payment=posting.post_payment_out, recalc_bills=balances.recalc_purchases,
    recalc_payments=balances.recalc_payments_out,
)
PAY_IN = PaymentKind(
    key='in', label='Receipt', party_label='party', model=PaymentIn, doc_type='payment_in', bill_model=Sale,
    bill_label='bill', allocation_model=SaleAllocation, allocation_fk='sale', origin_field='origin_sale',
    attachment_field='payment_in', post_payment=posting.post_payment_in, recalc_bills=balances.recalc_sales,
    recalc_payments=balances.recalc_payments_in,
)
PAY_OUT = PaymentKind(
    key='out', label='Payment', party_label='supplier', model=PaymentOut, doc_type='payment_out',
    bill_model=Purchase, bill_label='purchase bill', allocation_model=PurchaseAllocation,
    allocation_fk='purchase', origin_field='origin_purchase', attachment_field='payment_out',
    post_payment=posting.post_payment_out, recalc_bills=balances.recalc_purchases,
    recalc_payments=balances.recalc_payments_out,
)
BILL_KINDS = {'sale': SALE, 'purchase': PURCHASE}
PAYMENT_KINDS = {'in': PAY_IN, 'out': PAY_OUT}


def cash_account(business):
    from banking.models import BankAccount
    account = BankAccount.objects.filter(business=business, kind=BankAccount.KIND_CASH).first()
    if account is None:
        account = BankAccount.objects.create(business=business, kind=BankAccount.KIND_CASH, name='Cash in Hand')
    return account


def default_account(business):
    """Money received or paid with no account chosen goes through the bank account (B), never Cash."""
    from banking.models import BankAccount
    from banking.services import ensure_single_bank
    bank = BankAccount.objects.filter(business=business, kind=BankAccount.KIND_BANK).order_by('-is_default', 'id').first()
    return bank or ensure_single_bank(business)


# --------------------------------------------------------------------------- attachments

def sync_attachments(business, field, target, attachment_ids):
    wanted = {int(i) for i in (attachment_ids or [])}
    for att in Attachment.objects.filter(business=business, **{field: target}).exclude(id__in=wanted):
        att.delete()
    found = Attachment.objects.filter(business=business, id__in=wanted)
    if found.count() != len(wanted):
        raise ValidationError({'attachment_ids': 'One of the attachments was not found. Please upload it again.'})
    for att in found:
        if getattr(att, f'{field}_id') == target.id:
            continue
        if att.is_linked:
            raise ValidationError({'attachment_ids': 'An attachment already belongs to another record.'})
        setattr(att, field, target)
        att.save(update_fields=[field])


# --------------------------------------------------------------------------- bills

def ensure_party_role(party, bill_key):
    """Any party can be picked on a sale or a purchase. A customer used on a purchase (or a
    supplier used on a sale) becomes "Customer & Supplier" so its page, statement and
    reports show both sides."""
    from parties.models import Party

    role = Party.TYPE_SUPPLIER if bill_key == 'purchase' else Party.TYPE_CUSTOMER
    if party.party_type not in (role, Party.TYPE_BOTH):
        party.party_type = Party.TYPE_BOTH
        Party.objects.filter(pk=party.pk).update(party_type=Party.TYPE_BOTH)


def _assign_number(business, doc_type, instance, requested, label, errors):
    requested = (requested or '').strip()
    if not requested:
        if instance.pk:
            return instance.number, instance.prefix, instance.seq
        return numbering.next_number(business, doc_type)
    if len(requested) > 40:
        errors['number'] = 'Number is too long (max 40 characters).'
        return requested, '', None
    if numbering.number_exists(business, doc_type, requested, exclude_id=instance.pk):
        errors['number'] = f'{label} number "{requested}" already exists. Please use a different number.'
    prefix, seq = numbering.split_number(business, doc_type, requested)
    return requested, prefix, seq


@transaction.atomic
def save_bill(key, business, user, data, instance=None):
    k = BILL_KINDS[key]
    Model = k.model
    is_new = instance is None
    bill = instance or Model(business=business, created_by=user)
    settings = business.settings
    errors = {}

    old_party_id = None if is_new else bill.party_id
    old_item_ids = set() if is_new else set(bill.items.values_list('item_id', flat=True))
    origin = None if is_new else bill.origin_payments.first()
    old_origin_account_id = origin.account_id if origin else None
    linked_payment_ids = set() if is_new else set(
        k.allocation_model.objects.filter(**{k.allocation_fk: bill}).values_list('payment_id', flat=True))

    # The bill form has no Credit/Cash switch: the mode follows the money (see below).
    # `mode='cash'` is still accepted from API callers as "the full amount is received now".
    full_payment_requested = data.get('mode') == Model.MODE_CASH
    party = data.get('party')

    number, prefix, seq = _assign_number(business, key, bill, data.get('number'), k.label, errors)

    bill_date = data.get('date') or bill.date
    # Due dates are no longer entered on bills. Old bills keep theirs (for the overdue badge)
    # unless a caller sends one explicitly; nothing is filled in from the credit period.
    due_date_sent = 'due_date' in data
    due_date = data.get('due_date') if due_date_sent else (None if is_new else bill.due_date)

    computed_lines = []
    for index, line in enumerate(data.get('items') or []):
        item = line.get('item')
        values = calc_line(
            line.get('quantity'), line.get('rate'), line.get('discount_percent') or 0,
            line.get('discount_amount') or 0, line.get('tax_rate') or 0, line.get('tax_inclusive', False),
        )
        computed_lines.append({
            **values,
            'item': item,
            'name': (line.get('name') or (item.name if item else '')).strip()[:200],
            'code': (line.get('code') or (item.code if item else '') or '')[:50],
            'unit': (line.get('unit') or (item.unit if item else '') or '')[:20],
            'hsn': (line.get('hsn') or (item.hsn if item else '') or '')[:20],
            'position': index,
        })
        if not computed_lines[-1]['name']:
            errors[f'items.{index}.name'] = 'Item name is required.'

    totals = calc_bill(
        computed_lines,
        discount_percent=data.get('discount_percent') or 0,
        discount_amount=data.get('discount_amount') or 0,
        charges_amount=data.get('charges_amount') or 0,
        auto_round_off=data.get('auto_round_off', True),
        round_off=data.get('round_off') or 0,
        manual_total=data.get('total'),
    )
    if totals['total'] <= 0:
        errors['total'] = 'Bill total must be greater than zero. Add items or enter the total amount.'

    other_allocated = ZERO
    if not is_new:
        others = k.allocation_model.objects.filter(**{k.allocation_fk: bill})
        if origin:
            others = others.exclude(payment=origin)
        other_allocated = others.aggregate(s=Sum('amount'))['s'] or ZERO
        new_party_id = party.id if party else None
        if other_allocated and new_party_id != old_party_id:
            errors['party'] = ('Payments are already linked to this bill. Remove those payments before '
                               f'changing the {k.party_label}.')
        if totals['total'] < other_allocated:
            errors['total'] = (f'{fmt_money(other_allocated)} has already been paid against this bill, '
                               'so the total cannot be lower than that.')

    max_receivable = max(totals['total'] - other_allocated, ZERO)
    word = 'received' if key == 'sale' else 'paid'
    if full_payment_requested:
        received = max_receivable
    else:
        received = q2(data.get('received_amount') or 0)
        if received < 0:
            errors['received_amount'] = 'Amount cannot be negative.'
        elif received > max_receivable:
            errors['received_amount'] = f'{word.capitalize()} amount cannot be more than {fmt_money(max_receivable)}.'

    # Mode follows the money: fully received/paid while billing -> cash (a walk-in bill without a
    # party is allowed), anything left due -> credit (party required). Bills that already have
    # separately linked payments keep their mode.
    if not is_new and other_allocated > 0:
        mode = bill.mode
    elif totals['total'] > 0 and received >= max_receivable:
        mode = Model.MODE_CASH
    else:
        mode = Model.MODE_CREDIT
    if mode == Model.MODE_CREDIT and party is None and 'party' not in errors:
        errors['party'] = (f'Please select a {k.party_label}. A bill without a {k.party_label} '
                           f'must be fully {word}.')

    if mode == Model.MODE_CASH:
        due_date = None
    if due_date and due_date < bill_date:
        if due_date_sent:
            errors['due_date'] = 'Due date cannot be before the bill date.'
        else:
            due_date = None  # an old, now hidden due date that no longer fits the bill date

    account = data.get('payment_account')
    if received > 0 and (account is None or account.kind == account.KIND_CASH):
        account = default_account(business)  # money is kept only in the bank (B)

    if errors:
        raise ValidationError(errors)

    if party is not None:
        ensure_party_role(party, key)

    bill.number, bill.prefix, bill.seq = number, prefix, seq
    bill.date = bill_date
    bill.due_date = due_date
    bill.mode = mode
    bill.party = party
    walk_in = 'Cash Sale' if key == 'sale' else 'Cash Purchase'
    bill.party_name = (data.get('party_name') or '').strip()[:150] or (party.name if party else walk_in)
    bill.party_phone = (data.get('party_phone') if data.get('party_phone') is not None else '') or (
        party.phone if party else '')
    bill.party_address = (data.get('party_address') or '').strip() or (party.full_address if party else '')
    bill.party_gstin = (data.get('party_gstin') or '').strip().upper() or (party.gstin if party else '')
    for field in ('subtotal', 'item_discount', 'tax_total', 'items_total', 'discount_percent',
                  'discount_amount', 'charges_amount', 'round_off', 'total', 'manual_total'):
        setattr(bill, field, totals[field])
    bill.charges_label = (data.get('charges_label') or '').strip()[:60] if totals['charges_amount'] else ''
    bill.auto_round_off = bool(data.get('auto_round_off', True))
    bill.notes = (data.get('notes') or '').strip()
    if 'terms' in data:
        bill.terms = (data.get('terms') or '').strip()
    elif is_new:
        bill.terms = settings.default_terms
    bill.save()

    bill.items.all().delete()
    k.line_model.objects.bulk_create([k.line_model(**{k.line_fk: bill}, **line) for line in computed_lines])
    new_item_ids = {line['item'].id for line in computed_lines if line['item']}

    new_origin_account_id = None
    if received > 0:
        if origin is None:
            p_number, p_prefix, p_seq = numbering.next_number(business, k.payment_doc)
            origin = k.payment_model(business=business, number=p_number, prefix=p_prefix, seq=p_seq,
                                     created_by=user, **{k.origin_field: bill})
        origin.date = bill.date
        origin.party = party
        origin.party_name = bill.party_name
        origin.account = account
        origin.amount = received
        origin.reference_no = (data.get('payment_reference') or '').strip()[:80]
        origin.save()
        k.allocation_model.objects.filter(payment=origin).exclude(**{k.allocation_fk: bill}).delete()
        k.allocation_model.objects.update_or_create(
            payment=origin, **{k.allocation_fk: bill}, defaults={'amount': received})
        new_origin_account_id = account.id
    elif origin is not None:
        linked_payment_ids.discard(origin.id)
        origin.delete()
        origin = None

    if 'attachment_ids' in data:
        sync_attachments(business, k.attachment_field, bill, data.get('attachment_ids'))

    k.post_bill(bill)
    payment_ids = set(linked_payment_ids)
    if origin:
        payment_ids.add(origin.id)
    k.recalc_payments(payment_ids)
    for payment in k.payment_model.objects.filter(id__in=payment_ids).select_related('party'):
        k.post_payment(payment)

    k.recalc_bills([bill.id])
    balances.recalc_parties({old_party_id, bill.party_id})
    balances.recalc_items(old_item_ids | new_item_ids)
    balances.recalc_accounts({old_origin_account_id, new_origin_account_id} | set(
        k.payment_model.objects.filter(id__in=payment_ids).values_list('account_id', flat=True)))
    bill.refresh_from_db()
    return bill


def bill_delete_preview(key, bill):
    k = BILL_KINDS[key]
    allocations = k.allocation_model.objects.filter(**{k.allocation_fk: bill}).select_related('payment')
    origin_ids = set(bill.origin_payments.values_list('id', flat=True))
    linked = [a for a in allocations if a.payment_id not in origin_ids]
    return {
        'received_with_bill': str(sum((a.amount for a in allocations if a.payment_id in origin_ids), ZERO)),
        'linked_payments': [
            {'id': a.payment_id, 'number': a.payment.number, 'amount': str(a.amount), 'date': str(a.payment.date)}
            for a in linked
        ],
    }


@transaction.atomic
def delete_bill(key, bill, delete_linked_payments=False):
    k = BILL_KINDS[key]
    party_id = bill.party_id
    item_ids = set(bill.items.values_list('item_id', flat=True))
    allocations = list(k.allocation_model.objects.filter(**{k.allocation_fk: bill}).select_related('payment'))
    origin_ids = set(bill.origin_payments.values_list('id', flat=True))
    account_ids = {a.payment.account_id for a in allocations}
    account_ids |= set(bill.origin_payments.values_list('account_id', flat=True))
    linked_ids = {a.payment_id for a in allocations} - origin_ids
    party_ids = {party_id} | set(k.payment_model.objects.filter(id__in=linked_ids).values_list('party_id', flat=True))

    to_delete = set()
    if delete_linked_payments:
        for payment_id in linked_ids:
            shared = k.allocation_model.objects.filter(payment_id=payment_id).exclude(**{k.allocation_fk: bill})
            if not shared.exists():
                to_delete.add(payment_id)
    k.payment_model.objects.filter(id__in=to_delete).delete()
    bill.delete()

    remaining = linked_ids - to_delete
    k.recalc_payments(remaining)
    for payment in k.payment_model.objects.filter(id__in=remaining).select_related('party'):
        k.post_payment(payment)
    balances.recalc_parties(party_ids)
    balances.recalc_items(item_ids)
    balances.recalc_accounts(account_ids)


# --------------------------------------------------------------------------- payments

def pending_bills(kind_key, party, payment=None):
    k = PAYMENT_KINDS[kind_key]
    existing = {}
    if payment is not None and payment.pk:
        existing = {getattr(a, f'{k.allocation_fk}_id'): a.amount for a in payment.allocations.all()}
    bills = k.bill_model.objects.filter(business_id=party.business_id, party=party).order_by('date', 'id')
    rows = []
    for bill in bills:
        allocated = existing.get(bill.id, ZERO)
        available = bill.balance_due + allocated
        if available <= 0 and not allocated:
            continue
        rows.append({
            'id': bill.id,
            'number': bill.number,
            'date': bill.date,
            'due_date': bill.due_date,
            'total': bill.total,
            'paid_amount': bill.paid_amount - allocated,
            'balance_due': available,
            'allocated': allocated,
            'is_overdue': bill.is_overdue,
        })
    return rows


def fifo_allocations(kind_key, party, amount, payment=None):
    remaining = q2(amount)
    result = []
    for row in pending_bills(kind_key, party, payment):
        if remaining <= 0:
            break
        take = min(row['balance_due'], remaining)
        if take > 0:
            result.append({'bill_id': row['id'], 'amount': take})
            remaining -= take
    return result


def party_outstanding(kind_key, party, payment=None):
    """What the party owes (payment in) / what we owe the party (payment out),
    ignoring the effect of `payment` itself when editing."""
    own = ZERO
    if payment is not None and payment.pk and payment.party_id == party.id:
        own = payment.amount
    if kind_key == 'in':
        return party.balance + own
    return -party.balance + own


@transaction.atomic
def save_payment(kind_key, business, user, data, instance=None):
    k = PAYMENT_KINDS[kind_key]
    is_new = instance is None
    payment = instance or k.model(business=business, created_by=user)
    errors = {}

    origin_bill = None if is_new else getattr(payment, k.origin_field)
    old_party_id = None if is_new else payment.party_id
    old_account_id = None if is_new else payment.account_id
    old_bill_ids = set() if is_new else set(payment.allocations.values_list(f'{k.allocation_fk}_id', flat=True))

    party = origin_bill.party if origin_bill else data.get('party')
    if party is None and origin_bill is None:
        errors['party'] = f'Please select a {k.party_label}.'
    if party is not None:
        party.refresh_from_db(fields=['balance'])

    amount = q2(data.get('amount') or 0)
    if amount <= 0:
        errors['amount'] = 'Enter an amount greater than zero.'

    account = data.get('account') or (payment.account if payment.account_id else default_account(business))
    if account.kind == account.KIND_CASH:
        account = default_account(business)  # money is kept only in the bank (B)
    number, prefix, seq = _assign_number(business, k.doc_type, payment, data.get('number'), k.label, errors)
    payment_date = data.get('date') or payment.date

    allocations = {}
    if origin_bill is not None:
        others = k.allocation_model.objects.filter(**{k.allocation_fk: origin_bill}).exclude(payment=payment)
        max_amount = origin_bill.total - (others.aggregate(s=Sum('amount'))['s'] or ZERO)
        if origin_bill.mode == origin_bill.MODE_CASH and amount != max_amount and amount > 0:
            errors['amount'] = (f'This payment belongs to cash bill {origin_bill.number} and must equal '
                                f'{fmt_money(max_amount)}. Edit the bill to change it.')
        elif amount > max_amount:
            errors['amount'] = f'Amount cannot exceed the bill balance of {fmt_money(max_amount)}.'
        allocations[origin_bill.id] = amount
    elif party is not None and amount > 0:
        requested = data.get('allocations')
        if requested is None:
            requested = [
                {'bill': k.bill_model.objects.get(id=row['bill_id']), 'amount': row['amount']}
                for row in fifo_allocations(kind_key, party, amount, payment)
            ] if data.get('auto_allocate', True) else []
        existing = {} if is_new else {
            getattr(a, f'{k.allocation_fk}_id'): a.amount for a in payment.allocations.all()}
        for entry in requested:
            bill = entry['bill']
            value = q2(entry.get('amount') or 0)
            if value <= 0:
                continue
            if bill.business_id != business.id or bill.party_id != party.id:
                errors['allocations'] = f'{bill.number} does not belong to {party.name}.'
                continue
            available = bill.balance_due + existing.get(bill.id, ZERO)
            allocations[bill.id] = allocations.get(bill.id, ZERO) + value
            if allocations[bill.id] > available:
                errors['allocations'] = f'Only {fmt_money(available)} is pending on {bill.number}.'
        allocated_total = sum(allocations.values(), ZERO)
        if allocated_total > amount:
            errors['allocations'] = (f'Amounts linked to bills ({fmt_money(allocated_total)}) are more than the '
                                     f'payment amount ({fmt_money(amount)}).')
        # Any amount is accepted: whatever is not linked to a bill stays with the party as an advance.

    if errors:
        raise ValidationError(errors)

    payment.number, payment.prefix, payment.seq = number, prefix, seq
    payment.date = payment_date
    payment.party = party
    payment.party_name = party.name if party else (origin_bill.party_name if origin_bill else '')
    payment.account = account
    payment.amount = amount
    payment.reference_no = (data.get('reference_no') or '').strip()[:80]
    payment.notes = (data.get('notes') or '').strip()
    payment.save()

    payment.allocations.all().delete()
    k.allocation_model.objects.bulk_create([
        k.allocation_model(payment=payment, amount=value, **{f'{k.allocation_fk}_id': bill_id})
        for bill_id, value in allocations.items()
    ])

    if 'attachment_ids' in data:
        sync_attachments(business, k.attachment_field, payment, data.get('attachment_ids'))

    k.recalc_payments([payment.id])
    k.post_payment(payment)
    k.recalc_bills(old_bill_ids | set(allocations))
    balances.recalc_parties({old_party_id, payment.party_id})
    balances.recalc_accounts({old_account_id, payment.account_id})
    payment.refresh_from_db()
    return payment


@transaction.atomic
def delete_payment(kind_key, payment):
    k = PAYMENT_KINDS[kind_key]
    origin_bill = getattr(payment, k.origin_field)
    if origin_bill is not None and origin_bill.mode == origin_bill.MODE_CASH:
        raise ValidationError({'detail': f'This payment was recorded with cash bill {origin_bill.number}. '
                                         'Edit or delete that bill instead.'})
    bill_ids = set(payment.allocations.values_list(f'{k.allocation_fk}_id', flat=True))
    party_id = payment.party_id
    account_id = payment.account_id
    payment.delete()
    k.recalc_bills(bill_ids)
    balances.recalc_parties({party_id})
    balances.recalc_accounts({account_id})
