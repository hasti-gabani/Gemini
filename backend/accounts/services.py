from django.db import transaction

from .models import DEFAULT_TAX_RATES, DEFAULT_UNITS, Business, BusinessSettings


@transaction.atomic
def bootstrap_business(name, **fields):
    """Create a business with default settings and its Cash in Hand account."""
    from banking.models import BankAccount

    business = Business.objects.create(name=name, **fields)
    BusinessSettings.objects.create(business=business, units=list(DEFAULT_UNITS), tax_rates=list(DEFAULT_TAX_RATES))
    BankAccount.objects.create(business=business, kind=BankAccount.KIND_CASH, name='Cash in Hand')
    from banking.services import ensure_single_bank
    ensure_single_bank(business)
    return business


def ensure_business_ready(business):
    """Repair helper for businesses created outside bootstrap_business."""
    from banking.models import BankAccount

    BusinessSettings.objects.get_or_create(business=business)
    if not BankAccount.objects.filter(business=business, kind=BankAccount.KIND_CASH).exists():
        BankAccount.objects.create(business=business, kind=BankAccount.KIND_CASH, name='Cash in Hand')
