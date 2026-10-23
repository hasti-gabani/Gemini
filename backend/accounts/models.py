import secrets

from django.contrib.auth.models import AbstractUser
from django.db import models

DEFAULT_UNITS = [
    'PCS', 'NOS', 'KG', 'GM', 'LTR', 'ML', 'MTR', 'CM', 'FT', 'SQFT', 'BOX', 'PKT',
    'BAG', 'DZN', 'SET', 'PAIR', 'ROLL', 'BTL', 'CTN', 'QTL', 'TON', 'HRS',
]
DEFAULT_TAX_RATES = ['0', '3', '5', '12', '18', '28']
DEFAULT_TERMS = (
    '1. Goods once sold will not be taken back or exchanged.\n'
    '2. Please check the goods at the time of delivery.\n'
    '3. Subject to local jurisdiction.'
)
DEFAULT_REMINDER_TEMPLATE = (
    'નમસ્તે {name},\n'
    'આપની ₹{amount} ની ચુકવણી બાકી છે. કૃપા કરી {due_date} સુધીમાં ચુકવણી કરશો.\n\n'
    'Dear {name}, a payment of ₹{amount} is pending with us. Kindly pay by {due_date}.\n\n'
    '– {business} {phone}'
)


def _share_salt():
    return secrets.token_hex(8)


class Business(models.Model):
    name = models.CharField(max_length=150)
    logo = models.ImageField(upload_to='business/', blank=True, null=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=80, blank=True)
    pincode = models.CharField(max_length=10, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    gstin = models.CharField(max_length=15, blank=True)
    share_salt = models.CharField(max_length=32, default=_share_salt)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'businesses'

    def __str__(self):
        return self.name

    @property
    def full_address(self):
        parts = [self.address.strip()]
        city_line = ', '.join(p for p in [self.city.strip(), self.state.strip()] if p)
        if self.pincode:
            city_line = f'{city_line} - {self.pincode}' if city_line else self.pincode
        parts.append(city_line)
        return '\n'.join(p for p in parts if p)


class User(AbstractUser):
    ROLE_OWNER = 'owner'
    ROLE_STAFF = 'staff'
    ROLE_CHOICES = [(ROLE_OWNER, 'Owner'), (ROLE_STAFF, 'Staff')]

    business = models.ForeignKey(Business, on_delete=models.SET_NULL, null=True, blank=True, related_name='users')
    phone = models.CharField(max_length=20, blank=True)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default=ROLE_OWNER)

    @property
    def display_name(self):
        return self.get_full_name() or self.username


class LoginGuard(models.Model):
    """Wrong-password counter behind the temporary sign-in lockout.

    `key` is "user:<id>" for an existing account (so its email, mobile and username
    share one counter), "name:<text>" for an unknown login name, or "ip:<address>".
    Kept in the database so the lock also holds across restarts and server processes.
    """

    key = models.CharField(max_length=190, unique=True)
    failures = models.PositiveIntegerField(default=0)
    first_failure_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.key} ({self.failures} failures)'


class BusinessSettings(models.Model):
    FORMAT_A4 = 'a4'
    FORMAT_A5 = 'a5'
    FORMAT_THERMAL_80 = 'thermal80'
    FORMAT_THERMAL_58 = 'thermal58'
    FORMAT_CHOICES = [
        (FORMAT_A4, 'A4'),
        (FORMAT_A5, 'A5'),
        (FORMAT_THERMAL_80, 'Thermal 80mm'),
        (FORMAT_THERMAL_58, 'Thermal 58mm'),
    ]
    THEME_CHOICES = [('system', 'System'), ('light', 'Light'), ('dark', 'Dark')]
    LANGUAGE_CHOICES = [('en', 'English'), ('gu', 'ગુજરાતી')]
    MODE_CHOICES = [('cash', 'Cash'), ('bank', 'Bank')]

    business = models.OneToOneField(Business, on_delete=models.CASCADE, related_name='settings')

    # Numbering
    sale_prefix = models.CharField(max_length=20, blank=True, default='Bil.')
    sale_start_number = models.PositiveIntegerField(default=1)
    purchase_prefix = models.CharField(max_length=20, blank=True, default='PUR-')
    purchase_start_number = models.PositiveIntegerField(default=1)
    payment_in_prefix = models.CharField(max_length=20, blank=True, default='Receipt ')
    payment_in_start_number = models.PositiveIntegerField(default=1)
    payment_out_prefix = models.CharField(max_length=20, blank=True, default='Voucher ')
    payment_out_start_number = models.PositiveIntegerField(default=1)

    # Invoice / print
    invoice_title = models.CharField(max_length=40, default='Invoice')
    print_format = models.CharField(max_length=12, choices=FORMAT_CHOICES, default=FORMAT_A4)
    show_logo = models.BooleanField(default=True)
    show_gst = models.BooleanField(default=True)
    show_description = models.BooleanField(default=True)
    show_terms = models.BooleanField(default=True)
    show_bank_details = models.BooleanField(default=True)
    show_signature = models.BooleanField(default=True)
    show_amount_in_words = models.BooleanField(default=True)
    footer_note = models.CharField(max_length=200, blank=True, default='Thank you for your business!')
    default_terms = models.TextField(blank=True, default=DEFAULT_TERMS)
    default_notes = models.TextField(blank=True)

    # Payments
    default_payment_mode = models.CharField(max_length=10, choices=MODE_CHOICES, default='cash')
    allow_overpayment = models.BooleanField(default=False)
    credit_period_days = models.PositiveIntegerField(default=0)

    # Tax
    tax_enabled = models.BooleanField(default=True)
    tax_label = models.CharField(max_length=20, default='GST')
    tax_rates = models.JSONField(default=list)
    prices_include_tax = models.BooleanField(default=False)

    # Units
    units = models.JSONField(default=list)

    # Reminders
    reminder_template = models.TextField(blank=True, default=DEFAULT_REMINDER_TEMPLATE)
    reminder_lead_days = models.PositiveIntegerField(default=3)

    # Automatic daily backup: optional second copy (e.g. a Google Drive for desktop folder)
    backup_copy_folder = models.CharField(max_length=500, blank=True)
    backup_copy_status = models.CharField(max_length=10, blank=True)  # '' (not tried) | 'ok' | 'error'
    backup_copy_message = models.CharField(max_length=500, blank=True)
    backup_copy_checked_at = models.DateTimeField(null=True, blank=True)

    # Appearance
    theme = models.CharField(max_length=10, choices=THEME_CHOICES, default='system')
    language = models.CharField(max_length=5, choices=LANGUAGE_CHOICES, default='en')

    # Not used any more (deleting needs no PIN); kept so older backups still restore.
    delete_pin = models.CharField(max_length=128, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'business settings'

    def save(self, *args, **kwargs):
        if not self.tax_rates:
            self.tax_rates = list(DEFAULT_TAX_RATES)
        if not self.units:
            self.units = list(DEFAULT_UNITS)
        super().save(*args, **kwargs)

    def __str__(self):
        return f'Settings · {self.business}'
