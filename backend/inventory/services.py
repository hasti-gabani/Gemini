from django.db import transaction
from rest_framework.exceptions import ValidationError

from ledger import balances


@transaction.atomic
def save_item(item):
    item.save()
    balances.recalc_items([item.id])
    item.refresh_from_db()
    return item


def usage_count(item):
    return item.sale_lines.count() + item.purchase_lines.count()


@transaction.atomic
def delete_item(item, force=False):
    used = usage_count(item)
    if used and not force:
        raise ValidationError({
            'detail': f'"{item.name}" is used in {used} bill line{"s" if used != 1 else ""}. '
                      'Bills will keep the item name, but its stock history will be removed.',
            'requires_force': 'true',
        })
    item.delete()


@transaction.atomic
def adjust_stock(item, quantity, date, note=''):
    from .models import StockAdjustment

    adjustment = StockAdjustment.objects.create(
        business_id=item.business_id, item=item, quantity=quantity, date=date, note=note)
    balances.recalc_items([item.id])
    return adjustment


@transaction.atomic
def delete_adjustment(adjustment):
    item_id = adjustment.item_id
    adjustment.delete()
    balances.recalc_items([item_id])
