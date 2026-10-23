from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class BankAccount(models.Model):
    """A money account. Every business has exactly one `cash` account ("Cash in Hand")
    and exactly one `bank` account, named B (see banking.services.ensure_single_bank)."""

    KIND_CASH = 'cash'
    KIND_BANK = 'bank'
    KIND_CHOICES = [(KIND_CASH, 'Cash'), (KIND_BANK, 'Bank')]

    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE, related_name='bank_accounts')
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=KIND_BANK)
    name = models.CharField(max_length=120)
    bank_name = models.CharField(max_length=120, blank=True)
    account_name = models.CharField(max_length=120, blank=True)
    account_number = models.CharField(max_length=40, blank=True)
    ifsc = models.CharField(max_length=11, blank=True)
    branch = models.CharField(max_length=120, blank=True)
    upi_id = models.CharField(max_length=80, blank=True)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_date = models.DateField(default=timezone.localdate)
    notes = models.TextField(blank=True)
    is_default = models.BooleanField(default=False)
    print_on_invoice = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['kind', '-is_default', 'name']
        constraints = [
            models.UniqueConstraint(fields=['business'], condition=Q(kind='cash'), name='one_cash_account_per_business'),
        ]
        indexes = [models.Index(fields=['business', 'kind'])]

    def __str__(self):
        return self.name

    @property
    def masked_number(self):
        number = (self.account_number or '').strip()
        return f'XXXX{number[-4:]}' if len(number) > 4 else number


class BankAdjustment(models.Model):
    """Manual money movement: deposits, withdrawals, transfers and adjustments."""

    TYPE_DEPOSIT = 'deposit'      # cash -> bank
    TYPE_WITHDRAW = 'withdraw'    # bank -> cash
    TYPE_TRANSFER = 'transfer'    # account -> account
    TYPE_ADD = 'add'              # increase balance (e.g. capital, other income)
    TYPE_REDUCE = 'reduce'        # decrease balance (e.g. bank charges, expense)
    TYPE_CHOICES = [
        (TYPE_DEPOSIT, 'Cash deposit to bank'),
        (TYPE_WITHDRAW, 'Cash withdrawal from bank'),
        (TYPE_TRANSFER, 'Transfer between accounts'),
        (TYPE_ADD, 'Add money'),
        (TYPE_REDUCE, 'Reduce money'),
    ]

    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE, related_name='bank_adjustments')
    txn_type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    date = models.DateField(default=timezone.localdate)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    from_account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT, null=True, blank=True, related_name='outgoing_adjustments')
    to_account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT, null=True, blank=True, related_name='incoming_adjustments')
    description = models.CharField(max_length=255, blank=True)
    reference_no = models.CharField(max_length=80, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-id']
        indexes = [models.Index(fields=['business', 'date'])]

    def __str__(self):
        return f'{self.get_txn_type_display()} {self.amount}'
