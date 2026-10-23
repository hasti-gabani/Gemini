"""Global search across parties, items, bills and payments."""
import re

from django.db.models import Q

from core.money import fmt_money
from inventory.models import Item
from parties.models import Party
from transactions.models import PaymentIn, PaymentOut, Purchase, Sale


def global_search(business, query, limit=6):
    query = (query or '').strip()
    if len(query) < 1:
        return {'query': query, 'results': [], 'count': 0}
    digits = re.sub(r'\D', '', query)
    results = []

    party_q = Q(name__icontains=query) | Q(gstin__icontains=query)
    if len(digits) >= 3:
        party_q |= Q(phone__contains=digits) | Q(phone_alt__contains=digits)
    for party in Party.objects.filter(business=business).filter(party_q).order_by('name')[:limit]:
        state = 'Receivable' if party.balance > 0 else 'Payable' if party.balance < 0 else 'Settled'
        results.append({
            'type': 'party', 'id': party.id, 'title': party.name,
            'subtitle': ' · '.join(p for p in [party.phone, party.city] if p),
            'amount': str(abs(party.balance)), 'badge': state,
        })

    for item in Item.objects.filter(business=business).filter(
            Q(name__icontains=query) | Q(code__icontains=query) | Q(hsn__icontains=query)).order_by('name')[:limit]:
        results.append({
            'type': 'item', 'id': item.id, 'title': item.name,
            'subtitle': ' · '.join(p for p in [item.code, f'Stock {item.current_stock.normalize():f} {item.unit}'
                                              if item.track_stock else ''] if p),
            'amount': str(item.sale_price), 'badge': 'Low stock' if item.is_low_stock else '',
        })

    bill_q = Q(number__icontains=query) | Q(party_name__icontains=query)
    if len(digits) >= 3:
        bill_q |= Q(party_phone__contains=digits)
    for model, kind in ((Sale, 'sale'), (Purchase, 'purchase')):
        for bill in model.objects.filter(business=business).filter(bill_q).order_by('-date', '-id')[:limit]:
            results.append({
                'type': kind, 'id': bill.id, 'title': bill.number,
                'subtitle': f'{bill.party_name} · {bill.date.strftime("%d/%m/%Y")}',
                'amount': str(bill.total), 'badge': bill.get_payment_status_display(),
            })

    pay_q = Q(number__icontains=query) | Q(party_name__icontains=query) | Q(reference_no__icontains=query)
    for model, kind in ((PaymentIn, 'payment_in'), (PaymentOut, 'payment_out')):
        for payment in model.objects.filter(business=business).filter(pay_q).order_by('-date', '-id')[:limit]:
            results.append({
                'type': kind, 'id': payment.id, 'title': payment.number,
                'subtitle': f'{payment.party_name} · {payment.date.strftime("%d/%m/%Y")}'
                            + (f' · Ref {payment.reference_no}' if payment.reference_no else ''),
                'amount': str(payment.amount), 'badge': fmt_money(payment.amount),
            })

    return {'query': query, 'results': results, 'count': len(results)}
