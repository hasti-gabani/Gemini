from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


class Party(models.Model):
    """A customer and/or supplier. `balance` is cached from the ledger:
    positive = the party owes us (receivable), negative = we owe them (payable)."""

    TYPE_CUSTOMER = 'customer'
    TYPE_SUPPLIER = 'supplier'
    TYPE_BOTH = 'both'
    TYPE_CHOICES = [(TYPE_CUSTOMER, 'Customer'), (TYPE_SUPPLIER, 'Supplier'), (TYPE_BOTH, 'Customer & Supplier')]

    OPENING_RECEIVABLE = 'receivable'
    OPENING_PAYABLE = 'payable'
    OPENING_CHOICES = [(OPENING_RECEIVABLE, 'Receivable'), (OPENING_PAYABLE, 'Payable')]

    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE, related_name='parties')
    name = models.CharField(max_length=150)
    party_type = models.CharField(max_length=10, choices=TYPE_CHOICES, default=TYPE_CUSTOMER)
    phone = models.CharField(max_length=20, blank=True)
    phone_alt = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=80, blank=True)
    pincode = models.CharField(max_length=10, blank=True)
    gstin = models.CharField(max_length=15, blank=True)
    notes = models.TextField(blank=True)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_balance_type = models.CharField(max_length=10, choices=OPENING_CHOICES, default=OPENING_RECEIVABLE)
    opening_balance_date = models.DateField(default=timezone.localdate)
    is_active = models.BooleanField(default=True)
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    last_txn_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'parties'
        constraints = [
            models.UniqueConstraint(Lower('name'), 'business', name='unique_party_name_per_business'),
        ]
        indexes = [
            models.Index(fields=['business', 'name']),
            models.Index(fields=['business', 'phone']),
            models.Index(fields=['business', 'balance']),
        ]

    def __str__(self):
        return self.name

    @property
    def receivable(self):
        return self.balance if self.balance > 0 else 0

    @property
    def payable(self):
        return -self.balance if self.balance < 0 else 0

    @property
    def full_address(self):
        city_line = ', '.join(p for p in [self.city.strip(), self.state.strip()] if p)
        if self.pincode:
            city_line = f'{city_line} - {self.pincode}' if city_line else self.pincode
        return '\n'.join(p for p in [self.address.strip(), city_line] if p)

    @property
    def signed_opening(self):
        return self.opening_balance if self.opening_balance_type == self.OPENING_RECEIVABLE else -self.opening_balance


class Reminder(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_DONE = 'done'
    STATUS_CHOICES = [(STATUS_PENDING, 'Pending'), (STATUS_DONE, 'Done')]

    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE, related_name='reminders')
    party = models.ForeignKey(Party, on_delete=models.CASCADE, related_name='reminders')
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    due_date = models.DateField()
    message = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    last_sent_at = models.DateTimeField(null=True, blank=True)
    sent_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_date', 'id']
        indexes = [models.Index(fields=['business', 'status', 'due_date'])]

    def __str__(self):
        return f'Reminder · {self.party} · {self.amount}'
