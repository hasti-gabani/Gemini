from django.conf import settings
from django.db import models
from django.utils import timezone

MONEY = dict(max_digits=14, decimal_places=2, default=0)
QTY = dict(max_digits=14, decimal_places=3, default=0)


class BillBase(models.Model):
    """Shared structure of sale and purchase bills.

    Totals and payment status are computed by services.save_bill() and
    ledger.balances; never edit them directly.
    """

    MODE_CREDIT = 'credit'
    MODE_CASH = 'cash'
    MODE_CHOICES = [(MODE_CREDIT, 'Credit'), (MODE_CASH, 'Cash')]

    STATUS_UNPAID = 'unpaid'
    STATUS_PARTIAL = 'partial'
    STATUS_PAID = 'paid'
    STATUS_CHOICES = [(STATUS_UNPAID, 'Unpaid'), (STATUS_PARTIAL, 'Partially paid'), (STATUS_PAID, 'Paid')]

    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE)
    number = models.CharField(max_length=40)
    prefix = models.CharField(max_length=20, blank=True)
    seq = models.PositiveIntegerField(null=True, blank=True)
    date = models.DateField(default=timezone.localdate)
    due_date = models.DateField(null=True, blank=True)
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default=MODE_CREDIT)

    party = models.ForeignKey('parties.Party', on_delete=models.PROTECT, null=True, blank=True)
    party_name = models.CharField(max_length=150, blank=True)
    party_phone = models.CharField(max_length=20, blank=True)
    party_address = models.TextField(blank=True)
    party_gstin = models.CharField(max_length=15, blank=True)

    subtotal = models.DecimalField(**MONEY)
    item_discount = models.DecimalField(**MONEY)
    tax_total = models.DecimalField(**MONEY)
    items_total = models.DecimalField(**MONEY)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    discount_amount = models.DecimalField(**MONEY)
    charges_label = models.CharField(max_length=60, blank=True)
    charges_amount = models.DecimalField(**MONEY)
    auto_round_off = models.BooleanField(default=True)
    round_off = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    total = models.DecimalField(**MONEY)
    manual_total = models.BooleanField(default=False)

    paid_amount = models.DecimalField(**MONEY)
    balance_due = models.DecimalField(**MONEY)
    payment_status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_UNPAID)

    notes = models.TextField(blank=True)
    terms = models.TextField(blank=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ['-date', '-seq', '-id']

    def __str__(self):
        return self.number

    @property
    def is_overdue(self):
        return bool(self.due_date and self.balance_due > 0 and self.due_date < timezone.localdate())


class Sale(BillBase):
    class Meta(BillBase.Meta):
        default_related_name = 'sales'
        constraints = [models.UniqueConstraint(fields=['business', 'number'], name='unique_sale_number')]
        indexes = [
            models.Index(fields=['business', 'date']),
            models.Index(fields=['business', 'party', 'date']),
            models.Index(fields=['business', 'payment_status']),
            models.Index(fields=['business', 'prefix', 'seq']),
        ]


class Purchase(BillBase):
    class Meta(BillBase.Meta):
        default_related_name = 'purchases'
        constraints = [models.UniqueConstraint(fields=['business', 'number'], name='unique_purchase_number')]
        indexes = [
            models.Index(fields=['business', 'date']),
            models.Index(fields=['business', 'party', 'date']),
            models.Index(fields=['business', 'payment_status']),
            models.Index(fields=['business', 'prefix', 'seq']),
        ]


class BillLineBase(models.Model):
    item = models.ForeignKey('inventory.Item', on_delete=models.SET_NULL, null=True, blank=True)
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True)
    unit = models.CharField(max_length=20, blank=True)
    hsn = models.CharField(max_length=20, blank=True)
    quantity = models.DecimalField(**QTY)
    rate = models.DecimalField(**MONEY)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    discount_amount = models.DecimalField(**MONEY)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    tax_inclusive = models.BooleanField(default=False)
    gross = models.DecimalField(**MONEY)
    taxable_amount = models.DecimalField(**MONEY)
    tax_amount = models.DecimalField(**MONEY)
    amount = models.DecimalField(**MONEY)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        abstract = True
        ordering = ['position', 'id']

    def __str__(self):
        return f'{self.name} x {self.quantity}'


class SaleItem(BillLineBase):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name='items')

    class Meta(BillLineBase.Meta):
        default_related_name = 'sale_lines'


class PurchaseItem(BillLineBase):
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name='items')

    class Meta(BillLineBase.Meta):
        default_related_name = 'purchase_lines'


class PaymentBase(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE)
    number = models.CharField(max_length=40)
    prefix = models.CharField(max_length=20, blank=True)
    seq = models.PositiveIntegerField(null=True, blank=True)
    date = models.DateField(default=timezone.localdate)
    party = models.ForeignKey('parties.Party', on_delete=models.PROTECT, null=True, blank=True)
    party_name = models.CharField(max_length=150, blank=True)
    account = models.ForeignKey('banking.BankAccount', on_delete=models.PROTECT)
    amount = models.DecimalField(**MONEY)
    reference_no = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    allocated_amount = models.DecimalField(**MONEY)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ['-date', '-seq', '-id']

    def __str__(self):
        return self.number

    @property
    def unallocated_amount(self):
        return self.amount - self.allocated_amount


class PaymentIn(PaymentBase):
    origin_sale = models.ForeignKey(Sale, on_delete=models.CASCADE, null=True, blank=True,
                                    related_name='origin_payments',
                                    help_text='Set when the payment was received while creating the sale.')

    class Meta(PaymentBase.Meta):
        default_related_name = 'payments_in'
        verbose_name = 'payment in'
        verbose_name_plural = 'payments in'
        constraints = [models.UniqueConstraint(fields=['business', 'number'], name='unique_payment_in_number')]
        indexes = [
            models.Index(fields=['business', 'date']),
            models.Index(fields=['business', 'party', 'date']),
            models.Index(fields=['business', 'prefix', 'seq']),
        ]


class PaymentOut(PaymentBase):
    origin_purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, null=True, blank=True,
                                        related_name='origin_payments',
                                        help_text='Set when the payment was made while creating the purchase.')

    class Meta(PaymentBase.Meta):
        default_related_name = 'payments_out'
        verbose_name = 'payment out'
        verbose_name_plural = 'payments out'
        constraints = [models.UniqueConstraint(fields=['business', 'number'], name='unique_payment_out_number')]
        indexes = [
            models.Index(fields=['business', 'date']),
            models.Index(fields=['business', 'party', 'date']),
            models.Index(fields=['business', 'prefix', 'seq']),
        ]


class SaleAllocation(models.Model):
    payment = models.ForeignKey(PaymentIn, on_delete=models.CASCADE, related_name='allocations')
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name='allocations')
    amount = models.DecimalField(**MONEY)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['payment', 'sale'], name='unique_sale_allocation')]


class PurchaseAllocation(models.Model):
    payment = models.ForeignKey(PaymentOut, on_delete=models.CASCADE, related_name='allocations')
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name='allocations')
    amount = models.DecimalField(**MONEY)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['payment', 'purchase'], name='unique_purchase_allocation')]


class Attachment(models.Model):
    """Payment proof / bill photo. Uploaded first, then linked to one record."""

    KIND_IMAGE = 'image'
    KIND_PDF = 'pdf'
    KIND_CHOICES = [(KIND_IMAGE, 'Image'), (KIND_PDF, 'PDF')]

    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='attachments/%Y/%m/')
    original_name = models.CharField(max_length=150)
    content_type = models.CharField(max_length=60)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    size = models.PositiveIntegerField(default=0)
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, null=True, blank=True, related_name='attachments')
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, null=True, blank=True, related_name='attachments')
    payment_in = models.ForeignKey(PaymentIn, on_delete=models.CASCADE, null=True, blank=True,
                                   related_name='attachments')
    payment_out = models.ForeignKey(PaymentOut, on_delete=models.CASCADE, null=True, blank=True,
                                    related_name='attachments')
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.original_name

    @property
    def is_linked(self):
        return any([self.sale_id, self.purchase_id, self.payment_in_id, self.payment_out_id])
