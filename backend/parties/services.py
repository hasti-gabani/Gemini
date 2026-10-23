from django.db import transaction
from rest_framework.exceptions import ValidationError

from ledger import balances, posting


@transaction.atomic
def save_party(party):
    party.save()
    posting.post_party_opening(party)
    balances.recalc_parties([party.id])
    party.refresh_from_db()
    return party


def _delete_transactions(party):
    from transactions import services as tx

    for key, bills in (('sale', party.sales), ('purchase', party.purchases)):
        for bill in bills.all():
            tx.delete_bill(key, bill, delete_linked_payments=True)
    for key, payments in (('in', party.payments_in), ('out', party.payments_out)):
        for payment in payments.all():
            tx.delete_payment(key, payment)


def usage_counts(party):
    return {
        'sales': party.sales.count(),
        'purchases': party.purchases.count(),
        'payments_in': party.payments_in.count(),
        'payments_out': party.payments_out.count(),
    }


@transaction.atomic
def delete_party(party, with_transactions=False):
    """Delete a party. With `with_transactions` its bills and payments go first, through the
    normal deletes, so stock and cash/bank balances are put back."""
    if with_transactions:
        _delete_transactions(party)
    counts = usage_counts(party)
    total = sum(counts.values())
    if total:
        parts = []
        labels = {'sales': 'sale bill', 'purchases': 'purchase bill', 'payments_in': 'payment in',
                  'payments_out': 'payment out'}
        for key, count in counts.items():
            if count:
                parts.append(f'{count} {labels[key]}{"s" if count > 1 and not key.startswith("payments") else ""}')
        raise ValidationError({
            'detail': f'{party.name} has {", ".join(parts)}. Delete those transactions first, '
                      'or keep this party.',
        })
    party.delete()
