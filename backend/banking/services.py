from django.db import transaction
from rest_framework.exceptions import ValidationError

from ledger import balances, posting
from ledger.models import BankTransaction

from .models import BankAccount, BankAdjustment

BANK_NAME = 'B'


@transaction.atomic
def save_account(account):
    if account.is_default and account.kind == BankAccount.KIND_BANK:
        BankAccount.objects.filter(business_id=account.business_id, kind=BankAccount.KIND_BANK).exclude(
            id=account.id).update(is_default=False)
    account.save()
    balances.recalc_accounts([account.id])
    account.refresh_from_db()
    return account


def account_usage(account):
    return {
        'payments_in': account.payments_in.count(),
        'payments_out': account.payments_out.count(),
        'adjustments': BankAdjustment.objects.filter(from_account=account).count()
        + BankAdjustment.objects.filter(to_account=account).count(),
        'transactions': BankTransaction.objects.filter(account=account).count(),
    }


@transaction.atomic
def delete_account(account, move_to=None):
    from transactions.models import PaymentIn, PaymentOut

    if account.kind == BankAccount.KIND_CASH:
        raise ValidationError({'detail': 'Cash in Hand cannot be deleted.'})
    usage = account_usage(account)
    has_activity = usage['payments_in'] or usage['payments_out'] or usage['adjustments']
    if has_activity:
        if move_to is None:
            raise ValidationError({
                'detail': f'{account.name} has {usage["transactions"]} transaction(s). '
                          'Choose an account to move them to before deleting.',
                'requires_move': 'true',
            })
        if move_to.id == account.id or move_to.business_id != account.business_id:
            raise ValidationError({'move_to': 'Choose a different account.'})
        payments_in = list(PaymentIn.objects.filter(account=account).values_list('id', flat=True))
        payments_out = list(PaymentOut.objects.filter(account=account).values_list('id', flat=True))
        PaymentIn.objects.filter(id__in=payments_in).update(account=move_to)
        PaymentOut.objects.filter(id__in=payments_out).update(account=move_to)
        self_transfers = BankAdjustment.objects.filter(from_account=account, to_account=move_to) | \
            BankAdjustment.objects.filter(from_account=move_to, to_account=account)
        self_transfers.delete()
        BankAdjustment.objects.filter(from_account=account).update(from_account=move_to)
        BankAdjustment.objects.filter(to_account=account).update(to_account=move_to)
        for payment in PaymentIn.objects.filter(id__in=payments_in).select_related('party'):
            posting.post_payment_in(payment)
        for payment in PaymentOut.objects.filter(id__in=payments_out).select_related('party'):
            posting.post_payment_out(payment)
        for adj in BankAdjustment.objects.filter(from_account=move_to) | BankAdjustment.objects.filter(to_account=move_to):
            posting.post_adjustment(adj)
        move_to.opening_balance += account.opening_balance
        move_to.save(update_fields=['opening_balance', 'updated_at'])
    was_default = account.is_default
    account.delete()
    if move_to is not None:
        balances.recalc_accounts([move_to.id])
    if was_default:
        replacement = BankAccount.objects.filter(business_id=account.business_id, kind=BankAccount.KIND_BANK).first()
        if replacement:
            replacement.is_default = True
            replacement.save(update_fields=['is_default'])


def validate_adjustment_accounts(txn_type, from_account, to_account):
    errors = {}
    cash = BankAccount.KIND_CASH
    bank = BankAccount.KIND_BANK
    if txn_type == BankAdjustment.TYPE_DEPOSIT:
        if not from_account or from_account.kind != cash:
            errors['from_account'] = 'Deposits move money from Cash in Hand.'
        if not to_account or to_account.kind != bank:
            errors['to_account'] = 'Choose the bank account receiving the deposit.'
    elif txn_type == BankAdjustment.TYPE_WITHDRAW:
        if not from_account or from_account.kind != bank:
            errors['from_account'] = 'Choose the bank account to withdraw from.'
        if not to_account or to_account.kind != cash:
            errors['to_account'] = 'Withdrawals move money into Cash in Hand.'
    elif txn_type == BankAdjustment.TYPE_TRANSFER:
        if not from_account:
            errors['from_account'] = 'Choose the account to transfer from.'
        if not to_account:
            errors['to_account'] = 'Choose the account to transfer to.'
        if from_account and to_account and from_account.id == to_account.id:
            errors['to_account'] = 'Choose two different accounts.'
    elif txn_type == BankAdjustment.TYPE_ADD:
        if not to_account:
            errors['to_account'] = 'Choose the account to add money to.'
    elif txn_type == BankAdjustment.TYPE_REDUCE:
        if not from_account:
            errors['from_account'] = 'Choose the account to reduce money from.'
    if errors:
        raise ValidationError(errors)


@transaction.atomic
def save_adjustment(adj):
    old_ids = set()
    if adj.pk:
        old = BankAdjustment.objects.get(pk=adj.pk)
        old_ids = {old.from_account_id, old.to_account_id}
    if adj.txn_type == BankAdjustment.TYPE_ADD:
        adj.from_account = None
    if adj.txn_type == BankAdjustment.TYPE_REDUCE:
        adj.to_account = None
    adj.save()
    posting.post_adjustment(adj)
    balances.recalc_accounts(old_ids | {adj.from_account_id, adj.to_account_id})
    return adj


@transaction.atomic
def delete_adjustment(adj):
    ids = {adj.from_account_id, adj.to_account_id}
    adj.delete()
    balances.recalc_accounts(ids)


@transaction.atomic
def ensure_single_bank(business):
    """Keep exactly one bank account, named B: create it when missing and merge any other
    bank account (its payments, transfers and opening balance) into it."""
    banks = list(BankAccount.objects.filter(business=business, kind=BankAccount.KIND_BANK).order_by('-is_default', 'id'))
    if not banks:
        return save_account(BankAccount(business=business, kind=BankAccount.KIND_BANK, name=BANK_NAME,
                                        bank_name=BANK_NAME, is_default=True))
    bank = banks[0]
    for extra in banks[1:]:
        usage = account_usage(extra)
        if not (usage['payments_in'] or usage['payments_out'] or usage['adjustments']):
            bank.opening_balance += extra.opening_balance  # delete_account only carries it over with activity
            bank.save(update_fields=['opening_balance', 'updated_at'])
        delete_account(extra, move_to=bank)
    bank.refresh_from_db()
    bank.name, bank.is_default = BANK_NAME, True
    return save_account(bank)


@transaction.atomic
def move_cash_to_bank(business):
    """Money is kept only in the bank account (B). Move every payment, Cash in Hand adjustment and
    the opening cash into B; Cash in Hand itself stays (the app needs it) but is always empty."""
    from transactions.models import PaymentIn, PaymentOut

    cash = BankAccount.objects.filter(business=business, kind=BankAccount.KIND_CASH).first()
    if cash is None:
        return
    payments_in = list(PaymentIn.objects.filter(account=cash).values_list('id', flat=True))
    payments_out = list(PaymentOut.objects.filter(account=cash).values_list('id', flat=True))
    touching = BankAdjustment.objects.filter(from_account=cash) | BankAdjustment.objects.filter(to_account=cash)
    if not (payments_in or payments_out or touching.exists() or cash.opening_balance):
        return
    bank = (BankAccount.objects.filter(business=business, kind=BankAccount.KIND_BANK).order_by('-is_default', 'id').first()
            or ensure_single_bank(business))
    PaymentIn.objects.filter(id__in=payments_in).update(account=bank)
    PaymentOut.objects.filter(id__in=payments_out).update(account=bank)
    # deposits / withdrawals between Cash and B mean nothing once both are B
    (BankAdjustment.objects.filter(from_account=cash, to_account=bank)
     | BankAdjustment.objects.filter(from_account=bank, to_account=cash)).delete()
    moved = list((BankAdjustment.objects.filter(from_account=cash) | BankAdjustment.objects.filter(to_account=cash))
                 .values_list('id', flat=True))
    BankAdjustment.objects.filter(id__in=moved, from_account=cash).update(from_account=bank)
    BankAdjustment.objects.filter(id__in=moved, to_account=cash).update(to_account=bank)
    for payment in PaymentIn.objects.filter(id__in=payments_in).select_related('party'):
        posting.post_payment_in(payment)
    for payment in PaymentOut.objects.filter(id__in=payments_out).select_related('party'):
        posting.post_payment_out(payment)
    for adj in BankAdjustment.objects.filter(id__in=moved):
        posting.post_adjustment(adj)
    if cash.opening_balance:
        bank.opening_balance += cash.opening_balance
        bank.save(update_fields=['opening_balance', 'updated_at'])
        cash.opening_balance = 0
        cash.save(update_fields=['opening_balance', 'updated_at'])
    balances.recalc_accounts([cash.id, bank.id])
