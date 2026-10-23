"""Recompute cached balances from the source-of-truth rows.

Caches (Party.balance, BankAccount.current_balance, Item.current_stock,
bill paid/balance/status, payment allocated amounts) make lists fast; these
functions rebuild them from aggregates so they can never drift.
"""
from collections import defaultdict

from django.db.models import Max, Q, Sum

from core.money import ZERO

from .models import BankTransaction, LedgerEntry


def _ids(values):
    return {v for v in values if v}


def recalc_parties(party_ids):
    from parties.models import Party

    ids = _ids(party_ids)
    if not ids:
        return
    totals = {
        row['party_id']: row
        for row in LedgerEntry.objects.filter(party_id__in=ids).values('party_id').annotate(
            d=Sum('debit'), c=Sum('credit'),
            last=Max('date', filter=~Q(entry_type=LedgerEntry.TYPE_OPENING)),
        )
    }
    for party in Party.objects.filter(id__in=ids).only('id', 'balance', 'last_txn_date'):
        row = totals.get(party.id)
        balance = ((row['d'] or ZERO) - (row['c'] or ZERO)) if row else ZERO
        last = row['last'] if row else None
        if party.balance != balance or party.last_txn_date != last:
            Party.objects.filter(id=party.id).update(balance=balance, last_txn_date=last)


def recalc_accounts(account_ids):
    from banking.models import BankAccount

    ids = _ids(account_ids)
    if not ids:
        return
    totals = {
        row['account_id']: row
        for row in BankTransaction.objects.filter(account_id__in=ids).values('account_id').annotate(
            i=Sum('amount_in'), o=Sum('amount_out'))
    }
    for account in BankAccount.objects.filter(id__in=ids).only('id', 'opening_balance', 'current_balance'):
        row = totals.get(account.id) or {}
        balance = account.opening_balance + (row.get('i') or ZERO) - (row.get('o') or ZERO)
        if account.current_balance != balance:
            BankAccount.objects.filter(id=account.id).update(current_balance=balance)


def recalc_items(item_ids):
    from inventory.models import Item, StockAdjustment
    from transactions.models import PurchaseItem, SaleItem

    ids = _ids(item_ids)
    if not ids:
        return
    sold = {r['item_id']: r['q'] for r in SaleItem.objects.filter(item_id__in=ids).values('item_id').annotate(q=Sum('quantity'))}
    bought = {r['item_id']: r['q'] for r in PurchaseItem.objects.filter(item_id__in=ids).values('item_id').annotate(q=Sum('quantity'))}
    adjusted = {r['item_id']: r['q'] for r in StockAdjustment.objects.filter(item_id__in=ids).values('item_id').annotate(q=Sum('quantity'))}
    for item in Item.objects.filter(id__in=ids).only('id', 'opening_stock', 'current_stock', 'sold_qty', 'purchased_qty'):
        s = sold.get(item.id) or ZERO
        p = bought.get(item.id) or ZERO
        a = adjusted.get(item.id) or ZERO
        current = item.opening_stock + p - s + a
        if (item.current_stock, item.sold_qty, item.purchased_qty) != (current, s, p):
            Item.objects.filter(id=item.id).update(current_stock=current, sold_qty=s, purchased_qty=p)


def _recalc_bills(model, allocation_model, fk_name, bill_ids):
    ids = _ids(bill_ids)
    if not ids:
        return
    paid = {
        row[fk_name]: row['s']
        for row in allocation_model.objects.filter(**{f'{fk_name}__in': ids}).values(fk_name).annotate(s=Sum('amount'))
    }
    for bill in model.objects.filter(id__in=ids).only('id', 'total', 'paid_amount', 'balance_due', 'payment_status'):
        paid_amount = paid.get(bill.id) or ZERO
        balance = bill.total - paid_amount
        if paid_amount <= 0:
            status = model.STATUS_UNPAID if bill.total > 0 else model.STATUS_PAID
        elif balance <= 0:
            status = model.STATUS_PAID
        else:
            status = model.STATUS_PARTIAL
        if (bill.paid_amount, bill.balance_due, bill.payment_status) != (paid_amount, balance, status):
            model.objects.filter(id=bill.id).update(paid_amount=paid_amount, balance_due=balance, payment_status=status)


def recalc_sales(sale_ids):
    from transactions.models import Sale, SaleAllocation
    _recalc_bills(Sale, SaleAllocation, 'sale_id', sale_ids)


def recalc_purchases(purchase_ids):
    from transactions.models import Purchase, PurchaseAllocation
    _recalc_bills(Purchase, PurchaseAllocation, 'purchase_id', purchase_ids)


def _recalc_payments(model, allocation_model, payment_ids):
    ids = _ids(payment_ids)
    if not ids:
        return
    allocated = defaultdict(lambda: ZERO)
    for row in allocation_model.objects.filter(payment_id__in=ids).values('payment_id').annotate(s=Sum('amount')):
        allocated[row['payment_id']] = row['s'] or ZERO
    for payment in model.objects.filter(id__in=ids).only('id', 'allocated_amount'):
        value = allocated[payment.id]
        if payment.allocated_amount != value:
            model.objects.filter(id=payment.id).update(allocated_amount=value)


def recalc_payments_in(payment_ids):
    from transactions.models import PaymentIn, SaleAllocation
    _recalc_payments(PaymentIn, SaleAllocation, payment_ids)


def recalc_payments_out(payment_ids):
    from transactions.models import PaymentOut, PurchaseAllocation
    _recalc_payments(PaymentOut, PurchaseAllocation, payment_ids)


def rebuild_business(business):
    """Re-post every document and recompute all caches for a business."""
    from banking.models import BankAccount, BankAdjustment
    from inventory.models import Item
    from parties.models import Party
    from transactions.models import PaymentIn, PaymentOut, Purchase, Sale

    from . import posting

    LedgerEntry.objects.filter(business=business).delete()
    BankTransaction.objects.filter(business=business).delete()
    for party in Party.objects.filter(business=business):
        posting.post_party_opening(party)
    for sale in Sale.objects.filter(business=business).prefetch_related('items'):
        posting.post_sale(sale)
    for purchase in Purchase.objects.filter(business=business).prefetch_related('items'):
        posting.post_purchase(purchase)
    for payment in PaymentIn.objects.filter(business=business).select_related('party'):
        posting.post_payment_in(payment)
    for payment in PaymentOut.objects.filter(business=business).select_related('party'):
        posting.post_payment_out(payment)
    for adj in BankAdjustment.objects.filter(business=business).select_related('from_account', 'to_account'):
        posting.post_adjustment(adj)

    recalc_sales(Sale.objects.filter(business=business).values_list('id', flat=True))
    recalc_purchases(Purchase.objects.filter(business=business).values_list('id', flat=True))
    recalc_payments_in(PaymentIn.objects.filter(business=business).values_list('id', flat=True))
    recalc_payments_out(PaymentOut.objects.filter(business=business).values_list('id', flat=True))
    recalc_parties(Party.objects.filter(business=business).values_list('id', flat=True))
    recalc_accounts(BankAccount.objects.filter(business=business).values_list('id', flat=True))
    recalc_items(Item.objects.filter(business=business).values_list('id', flat=True))
