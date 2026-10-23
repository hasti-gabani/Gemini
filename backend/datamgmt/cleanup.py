"""Delete old transactions safely.

`plan()` decides exactly which records match the options; `preview()` counts
them and `execute()` deletes the same set, so the numbers shown to the user
are the numbers deleted.

With `carry_forward` (default) the net effect of deleted records is moved into
opening balances — party opening balance, cash/bank opening balance and item
opening stock — so every current balance and stock figure stays unchanged.
"""
from collections import defaultdict
from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import Exists, OuterRef, Q, Sum
from rest_framework.exceptions import ValidationError

from banking.models import BankAccount, BankAdjustment
from core.dates import add_months, today
from core.money import ZERO, money_str
from inventory.models import Item, StockAdjustment
from ledger import balances
from ledger.models import BankTransaction, LedgerEntry
from parties.models import Party, Reminder
from transactions.models import (
    Attachment, PaymentIn, PaymentOut, Purchase, PurchaseAllocation, PurchaseItem, Sale, SaleAllocation, SaleItem,
)

PERIODS = {'1m': (1, '1 month'), '2m': (2, '2 months'), '3m': (3, '3 months'), '6m': (6, '6 months'),
           '1y': (12, '1 year')}
CATEGORIES = ('sales', 'purchases', 'payments_in', 'payments_out', 'bank_adjustments', 'stock_adjustments',
              'reminders')
MASTERS = ('parties', 'items')


@dataclass
class Plan:
    cutoff: object
    carry_forward: bool
    sale_ids: set = field(default_factory=set)
    purchase_ids: set = field(default_factory=set)
    payment_in_ids: set = field(default_factory=set)
    payment_out_ids: set = field(default_factory=set)
    origin_in_ids: set = field(default_factory=set)
    origin_out_ids: set = field(default_factory=set)
    bank_adjustment_ids: set = field(default_factory=set)
    stock_adjustment_ids: set = field(default_factory=set)
    reminder_ids: set = field(default_factory=set)
    masters: set = field(default_factory=set)


def parse_options(data):
    older_than = data.get('older_than')
    if older_than not in PERIODS:
        raise ValidationError({'older_than': 'Choose how old the data must be (1, 2, 3, 6 months or 1 year).'})
    include = {key for key in (data.get('include') or []) if key in CATEGORIES}
    masters = {key for key in (data.get('masters') or []) if key in MASTERS}
    if not include and not masters:
        raise ValidationError({'include': 'Select at least one type of data to delete.'})
    carry_forward = data.get('carry_forward', True)
    if isinstance(carry_forward, str):
        carry_forward = carry_forward.lower() in ('1', 'true', 'yes', 'on')
    return older_than, include, masters, bool(carry_forward)


def build_plan(business, older_than, include, masters, carry_forward):
    months, _label = PERIODS[older_than]
    cutoff = add_months(today(), -months)
    plan = Plan(cutoff=cutoff, carry_forward=carry_forward, masters=set(masters))

    if 'sales' in include:
        plan.sale_ids = set(Sale.objects.filter(business=business, date__lt=cutoff).values_list('id', flat=True))
    if 'purchases' in include:
        plan.purchase_ids = set(Purchase.objects.filter(business=business, date__lt=cutoff).values_list('id', flat=True))

    # Payments received/paid together with a deleted bill go with that bill.
    plan.origin_in_ids = set(PaymentIn.objects.filter(origin_sale_id__in=plan.sale_ids).values_list('id', flat=True))
    plan.origin_out_ids = set(PaymentOut.objects.filter(origin_purchase_id__in=plan.purchase_ids)
                              .values_list('id', flat=True))

    if 'payments_in' in include:
        kept_bill_link = Exists(SaleAllocation.objects.filter(payment=OuterRef('pk')).exclude(sale_id__in=plan.sale_ids))
        qs = (PaymentIn.objects.filter(business=business, date__lt=cutoff)
              .exclude(Q(origin_sale__isnull=False) & ~Q(origin_sale_id__in=plan.sale_ids))
              .exclude(kept_bill_link))
        plan.payment_in_ids = set(qs.values_list('id', flat=True))
    if 'payments_out' in include:
        kept_bill_link = Exists(PurchaseAllocation.objects.filter(payment=OuterRef('pk'))
                                .exclude(purchase_id__in=plan.purchase_ids))
        qs = (PaymentOut.objects.filter(business=business, date__lt=cutoff)
              .exclude(Q(origin_purchase__isnull=False) & ~Q(origin_purchase_id__in=plan.purchase_ids))
              .exclude(kept_bill_link))
        plan.payment_out_ids = set(qs.values_list('id', flat=True))
    plan.payment_in_ids |= plan.origin_in_ids
    plan.payment_out_ids |= plan.origin_out_ids

    if 'bank_adjustments' in include:
        plan.bank_adjustment_ids = set(BankAdjustment.objects.filter(business=business, date__lt=cutoff)
                                       .values_list('id', flat=True))
    if 'stock_adjustments' in include:
        plan.stock_adjustment_ids = set(StockAdjustment.objects.filter(business=business, date__lt=cutoff)
                                        .values_list('id', flat=True))
    if 'reminders' in include:
        plan.reminder_ids = set(Reminder.objects.filter(business=business, status=Reminder.STATUS_DONE,
                                                        due_date__lt=cutoff).values_list('id', flat=True))
    return plan


def _unused_parties(business, plan):
    remaining = Q()
    for model, ids in ((Sale, plan.sale_ids), (Purchase, plan.purchase_ids), (PaymentIn, plan.payment_in_ids),
                       (PaymentOut, plan.payment_out_ids)):
        remaining |= Exists(model.objects.filter(party=OuterRef('pk')).exclude(id__in=ids))
    pending_reminders = Exists(Reminder.objects.filter(party=OuterRef('pk')).exclude(id__in=plan.reminder_ids))
    candidates = Party.objects.filter(business=business).exclude(remaining).exclude(pending_reminders)
    if plan.carry_forward:
        # balances are preserved, so only parties that are settled can go
        return candidates.filter(balance=0)
    return candidates.filter(opening_balance=0)


def _unused_items(business, plan):
    used = (Exists(SaleItem.objects.filter(item=OuterRef('pk')).exclude(sale_id__in=plan.sale_ids))
            | Exists(PurchaseItem.objects.filter(item=OuterRef('pk')).exclude(purchase_id__in=plan.purchase_ids))
            | Exists(StockAdjustment.objects.filter(item=OuterRef('pk')).exclude(id__in=plan.stock_adjustment_ids)))
    candidates = Item.objects.filter(business=business).exclude(used)
    if plan.carry_forward:
        return candidates.filter(Q(track_stock=False) | Q(current_stock=0))
    return candidates.filter(Q(track_stock=False) | Q(opening_stock=0))


def preview(business, plan):
    counts = {
        'sales': len(plan.sale_ids),
        'sale_items': SaleItem.objects.filter(sale_id__in=plan.sale_ids).count(),
        'purchases': len(plan.purchase_ids),
        'purchase_items': PurchaseItem.objects.filter(purchase_id__in=plan.purchase_ids).count(),
        'payments_in': len(plan.payment_in_ids),
        'payments_out': len(plan.payment_out_ids),
        'bank_adjustments': len(plan.bank_adjustment_ids),
        'stock_adjustments': len(plan.stock_adjustment_ids),
        'reminders': len(plan.reminder_ids),
    }
    derived = {
        'ledger_entries': LedgerEntry.objects.filter(
            Q(sale_id__in=plan.sale_ids) | Q(purchase_id__in=plan.purchase_ids)
            | Q(payment_in_id__in=plan.payment_in_ids) | Q(payment_out_id__in=plan.payment_out_ids)).count(),
        'bank_transactions': BankTransaction.objects.filter(
            Q(payment_in_id__in=plan.payment_in_ids) | Q(payment_out_id__in=plan.payment_out_ids)
            | Q(adjustment_id__in=plan.bank_adjustment_ids)).count(),
        'attachments': Attachment.objects.filter(
            Q(sale_id__in=plan.sale_ids) | Q(purchase_id__in=plan.purchase_ids)
            | Q(payment_in_id__in=plan.payment_in_ids) | Q(payment_out_id__in=plan.payment_out_ids)).count(),
    }
    masters = {
        'parties': _unused_parties(business, plan).count() if 'parties' in plan.masters else 0,
        'items': _unused_items(business, plan).count() if 'items' in plan.masters else 0,
    }
    primary = (counts['sales'] + counts['purchases'] + counts['payments_in'] + counts['payments_out']
               + counts['bank_adjustments'] + counts['stock_adjustments'] + counts['reminders']
               + masters['parties'] + masters['items'])
    return {
        'cutoff': plan.cutoff,
        'carry_forward': plan.carry_forward,
        'counts': counts,
        'origin_payments': {'payments_in': len(plan.origin_in_ids), 'payments_out': len(plan.origin_out_ids)},
        'derived': derived,
        'masters': masters,
        'total': primary,
        'balance_impact': None if plan.carry_forward else _balance_impact(plan),
    }


def _balance_impact(plan):
    ledger = LedgerEntry.objects.filter(
        Q(sale_id__in=plan.sale_ids) | Q(purchase_id__in=plan.purchase_ids)
        | Q(payment_in_id__in=plan.payment_in_ids) | Q(payment_out_id__in=plan.payment_out_ids)
    ).aggregate(d=Sum('debit'), c=Sum('credit'))
    bank = BankTransaction.objects.filter(
        Q(payment_in_id__in=plan.payment_in_ids) | Q(payment_out_id__in=plan.payment_out_ids)
        | Q(adjustment_id__in=plan.bank_adjustment_ids)
    ).aggregate(i=Sum('amount_in'), o=Sum('amount_out'))
    return {
        'party_balance_change': money_str(-((ledger['d'] or ZERO) - (ledger['c'] or ZERO))),
        'cash_bank_change': money_str(-((bank['i'] or ZERO) - (bank['o'] or ZERO))),
    }


def _carry_forward(plan):
    party_delta = defaultdict(lambda: ZERO)
    for row in LedgerEntry.objects.filter(
            Q(sale_id__in=plan.sale_ids) | Q(purchase_id__in=plan.purchase_ids)
            | Q(payment_in_id__in=plan.payment_in_ids) | Q(payment_out_id__in=plan.payment_out_ids)
    ).values('party_id').annotate(d=Sum('debit'), c=Sum('credit')):
        party_delta[row['party_id']] += (row['d'] or ZERO) - (row['c'] or ZERO)

    account_delta = defaultdict(lambda: ZERO)
    for row in BankTransaction.objects.filter(
            Q(payment_in_id__in=plan.payment_in_ids) | Q(payment_out_id__in=plan.payment_out_ids)
            | Q(adjustment_id__in=plan.bank_adjustment_ids)
    ).values('account_id').annotate(i=Sum('amount_in'), o=Sum('amount_out')):
        account_delta[row['account_id']] += (row['i'] or ZERO) - (row['o'] or ZERO)

    item_delta = defaultdict(lambda: ZERO)
    for row in SaleItem.objects.filter(sale_id__in=plan.sale_ids, item__isnull=False).values('item_id').annotate(
            q=Sum('quantity')):
        item_delta[row['item_id']] -= row['q'] or ZERO
    for row in PurchaseItem.objects.filter(purchase_id__in=plan.purchase_ids, item__isnull=False).values(
            'item_id').annotate(q=Sum('quantity')):
        item_delta[row['item_id']] += row['q'] or ZERO
    for row in StockAdjustment.objects.filter(id__in=plan.stock_adjustment_ids).values('item_id').annotate(
            q=Sum('quantity')):
        item_delta[row['item_id']] += row['q'] or ZERO
    return party_delta, account_delta, item_delta


@transaction.atomic
def execute(business, plan):
    result = preview(business, plan)
    party_delta, account_delta, item_delta = _carry_forward(plan) if plan.carry_forward else ({}, {}, {})
    master_parties = list(_unused_parties(business, plan).values_list('id', flat=True)) \
        if 'parties' in plan.masters else []
    master_items = list(_unused_items(business, plan).values_list('id', flat=True)) if 'items' in plan.masters else []

    for attachment in Attachment.objects.filter(
            Q(sale_id__in=plan.sale_ids) | Q(purchase_id__in=plan.purchase_ids)
            | Q(payment_in_id__in=plan.payment_in_ids) | Q(payment_out_id__in=plan.payment_out_ids)):
        attachment.delete()
    PaymentIn.objects.filter(id__in=plan.payment_in_ids).delete()
    PaymentOut.objects.filter(id__in=plan.payment_out_ids).delete()
    Sale.objects.filter(id__in=plan.sale_ids).delete()
    Purchase.objects.filter(id__in=plan.purchase_ids).delete()
    BankAdjustment.objects.filter(id__in=plan.bank_adjustment_ids).delete()
    StockAdjustment.objects.filter(id__in=plan.stock_adjustment_ids).delete()
    Reminder.objects.filter(id__in=plan.reminder_ids).delete()

    cutoff = plan.cutoff
    for party in Party.objects.filter(id__in=[pid for pid, delta in party_delta.items() if delta]):
        signed = party.signed_opening + party_delta[party.id]
        party.opening_balance = abs(signed)
        party.opening_balance_type = Party.OPENING_RECEIVABLE if signed >= 0 else Party.OPENING_PAYABLE
        party.opening_balance_date = max(party.opening_balance_date, cutoff)
        party.save(update_fields=['opening_balance', 'opening_balance_type', 'opening_balance_date', 'updated_at'])
    for account in BankAccount.objects.filter(id__in=[aid for aid, delta in account_delta.items() if delta]):
        account.opening_balance += account_delta[account.id]
        account.opening_date = max(account.opening_date, cutoff)
        account.save(update_fields=['opening_balance', 'opening_date', 'updated_at'])
    for item in Item.objects.filter(id__in=[iid for iid, delta in item_delta.items() if delta]):
        item.opening_stock += item_delta[item.id]
        item.save(update_fields=['opening_stock', 'updated_at'])

    if master_parties:
        Party.objects.filter(id__in=master_parties).delete()
    if master_items:
        for item in Item.objects.filter(id__in=master_items):
            item.delete()

    balances.rebuild_business(business)
    return result
