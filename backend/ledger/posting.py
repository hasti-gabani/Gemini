"""Posting engine: turns source documents into LedgerEntry / BankTransaction rows.

Each post_* function is idempotent: it removes the rows previously generated
for that document and recreates them from the current document state.
"""
from core.money import ZERO, fmt_qty

from .models import BankTransaction, LedgerEntry

SORT_OPENING = 0
SORT_BILL = 1
SORT_PAYMENT = 2


def _items_summary(bill):
    lines = list(bill.items.all())
    names = '\n'.join(line.name for line in lines)
    qtys = '\n'.join(f'{fmt_qty(line.quantity)} {line.unit}'.strip() for line in lines)
    return names, qtys


def post_party_opening(party):
    LedgerEntry.objects.filter(party=party, entry_type=LedgerEntry.TYPE_OPENING).delete()
    if not party.opening_balance:
        return
    receivable = party.opening_balance_type == party.OPENING_RECEIVABLE
    LedgerEntry.objects.create(
        business_id=party.business_id,
        party=party,
        date=party.opening_balance_date,
        entry_type=LedgerEntry.TYPE_OPENING,
        number='',
        description='Opening balance',
        debit=party.opening_balance if receivable else ZERO,
        credit=ZERO if receivable else party.opening_balance,
        sort_order=SORT_OPENING,
        source_created_at=party.created_at,
    )


def post_sale(sale):
    LedgerEntry.objects.filter(sale=sale).delete()
    if not sale.party_id:
        return
    names, qtys = _items_summary(sale)
    LedgerEntry.objects.create(
        business_id=sale.business_id,
        party_id=sale.party_id,
        date=sale.date,
        entry_type=LedgerEntry.TYPE_SALE,
        number=sale.number,
        description='Sale' + (' (Cash)' if sale.mode == sale.MODE_CASH else ''),
        items_summary=names,
        qty_summary=qtys,
        debit=sale.total,
        credit=ZERO,
        sort_order=SORT_BILL,
        source_created_at=sale.created_at,
        sale=sale,
    )


def post_purchase(purchase):
    LedgerEntry.objects.filter(purchase=purchase).delete()
    if not purchase.party_id:
        return
    names, qtys = _items_summary(purchase)
    LedgerEntry.objects.create(
        business_id=purchase.business_id,
        party_id=purchase.party_id,
        date=purchase.date,
        entry_type=LedgerEntry.TYPE_PURCHASE,
        number=purchase.number,
        description='Purchase' + (' (Cash)' if purchase.mode == purchase.MODE_CASH else ''),
        items_summary=names,
        qty_summary=qtys,
        debit=ZERO,
        credit=purchase.total,
        sort_order=SORT_BILL,
        source_created_at=purchase.created_at,
        purchase=purchase,
    )


def _against_text(payment, bill_attr):
    numbers = [getattr(a, bill_attr).number for a in payment.allocations.select_related(bill_attr)]
    return ', '.join(numbers)


def post_payment_in(payment):
    LedgerEntry.objects.filter(payment_in=payment).delete()
    BankTransaction.objects.filter(payment_in=payment).delete()
    against = _against_text(payment, 'sale')
    party_label = payment.party_name or (payment.party.name if payment.party_id else 'Walk-in customer')
    if payment.party_id:
        LedgerEntry.objects.create(
            business_id=payment.business_id,
            party_id=payment.party_id,
            date=payment.date,
            entry_type=LedgerEntry.TYPE_PAYMENT_IN,
            number=payment.number,
            description=f'Payment received{" against " + against if against else ""}',
            items_summary='Payment',
            debit=ZERO,
            credit=payment.amount,
            sort_order=SORT_PAYMENT,
            source_created_at=payment.created_at,
            payment_in=payment,
        )
    BankTransaction.objects.create(
        business_id=payment.business_id,
        account_id=payment.account_id,
        date=payment.date,
        txn_type=BankTransaction.TYPE_PAYMENT_IN,
        number=payment.number,
        description=f'Received from {party_label}{" · " + against if against else ""}',
        reference_no=payment.reference_no,
        amount_in=payment.amount,
        amount_out=ZERO,
        party_id=payment.party_id,
        source_created_at=payment.created_at,
        payment_in=payment,
    )


def post_payment_out(payment):
    LedgerEntry.objects.filter(payment_out=payment).delete()
    BankTransaction.objects.filter(payment_out=payment).delete()
    against = _against_text(payment, 'purchase')
    party_label = payment.party_name or (payment.party.name if payment.party_id else 'Cash purchase')
    if payment.party_id:
        LedgerEntry.objects.create(
            business_id=payment.business_id,
            party_id=payment.party_id,
            date=payment.date,
            entry_type=LedgerEntry.TYPE_PAYMENT_OUT,
            number=payment.number,
            description=f'Payment paid{" against " + against if against else ""}',
            items_summary='Payment',
            debit=payment.amount,
            credit=ZERO,
            sort_order=SORT_PAYMENT,
            source_created_at=payment.created_at,
            payment_out=payment,
        )
    BankTransaction.objects.create(
        business_id=payment.business_id,
        account_id=payment.account_id,
        date=payment.date,
        txn_type=BankTransaction.TYPE_PAYMENT_OUT,
        number=payment.number,
        description=f'Paid to {party_label}{" · " + against if against else ""}',
        reference_no=payment.reference_no,
        amount_in=ZERO,
        amount_out=payment.amount,
        party_id=payment.party_id,
        source_created_at=payment.created_at,
        payment_out=payment,
    )


ADJUSTMENT_LEGS = {
    # txn_type: [(account attr, bank txn type, direction)]
    'deposit': [('from_account', BankTransaction.TYPE_DEPOSIT, 'out'), ('to_account', BankTransaction.TYPE_DEPOSIT, 'in')],
    'withdraw': [('from_account', BankTransaction.TYPE_WITHDRAW, 'out'), ('to_account', BankTransaction.TYPE_WITHDRAW, 'in')],
    'transfer': [('from_account', BankTransaction.TYPE_TRANSFER_OUT, 'out'), ('to_account', BankTransaction.TYPE_TRANSFER_IN, 'in')],
    'add': [('to_account', BankTransaction.TYPE_ADD, 'in')],
    'reduce': [('from_account', BankTransaction.TYPE_REDUCE, 'out')],
}


def adjustment_description(adj):
    base = adj.get_txn_type_display()
    if adj.txn_type in ('deposit', 'withdraw', 'transfer') and adj.from_account_id and adj.to_account_id:
        base = f'{base}: {adj.from_account.name} → {adj.to_account.name}'
    return f'{base}{" · " + adj.description if adj.description else ""}'[:255]


def post_adjustment(adj):
    BankTransaction.objects.filter(adjustment=adj).delete()
    description = adjustment_description(adj)
    rows = []
    for attr, txn_type, direction in ADJUSTMENT_LEGS[adj.txn_type]:
        account_id = getattr(adj, f'{attr}_id')
        if not account_id:
            continue
        rows.append(BankTransaction(
            business_id=adj.business_id,
            account_id=account_id,
            date=adj.date,
            txn_type=txn_type,
            number='',
            description=description,
            reference_no=adj.reference_no,
            amount_in=adj.amount if direction == 'in' else ZERO,
            amount_out=adj.amount if direction == 'out' else ZERO,
            source_created_at=adj.created_at,
            adjustment=adj,
        ))
    BankTransaction.objects.bulk_create(rows)
