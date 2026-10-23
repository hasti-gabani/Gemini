"""Bill arithmetic. Mirrored exactly by frontend/src/lib/billCalc.js.

Line:
    gross    = qty x rate                                   (round 2dp)
    discount = gross x disc% / 100  (or fixed amount)       (round 2dp, 0..gross)
    net      = gross - discount
    tax exclusive: taxable = net;  tax = net x tax% / 100   (round 2dp); amount = net + tax
    tax inclusive: taxable = net x 100 / (100 + tax%)       (round 2dp); tax = net - taxable; amount = net
Bill:
    items_total = sum(line.amount)
    discount    = items_total x disc% / 100 (or fixed)      (round 2dp, 0..items_total)
    pre_round   = items_total - discount + charges
    round_off   = round_to_rupee(pre_round) - pre_round     (when auto)
    total       = pre_round + round_off
"""
from decimal import Decimal

from core.money import D, HUNDRED, ZERO, q2, q3, round_rupee

MAX_ROUND_OFF = Decimal('0.99')


def calc_line(quantity, rate, discount_percent=0, discount_amount=0, tax_rate=0, tax_inclusive=False):
    qty = q3(quantity)
    rate = q2(rate)
    disc_pct = q2(discount_percent)
    tax_pct = q2(tax_rate)
    gross = q2(qty * rate)
    if disc_pct > 0:
        discount = q2(gross * disc_pct / HUNDRED)
    else:
        discount = q2(discount_amount)
    discount = min(max(discount, ZERO), gross) if gross >= 0 else ZERO
    net = gross - discount
    if tax_pct > 0 and tax_inclusive:
        taxable = q2(net * HUNDRED / (HUNDRED + tax_pct))
        tax = net - taxable
        amount = net
    elif tax_pct > 0:
        taxable = net
        tax = q2(net * tax_pct / HUNDRED)
        amount = net + tax
    else:
        taxable = net
        tax = ZERO
        amount = net
    return {
        'quantity': qty,
        'rate': rate,
        'discount_percent': disc_pct if disc_pct > 0 else ZERO,
        'discount_amount': discount,
        'tax_rate': tax_pct,
        'tax_inclusive': bool(tax_inclusive) and tax_pct > 0,
        'gross': gross,
        'taxable_amount': taxable,
        'tax_amount': tax,
        'amount': amount,
    }


def calc_bill(lines, discount_percent=0, discount_amount=0, charges_amount=0,
              auto_round_off=True, round_off=0, manual_total=None):
    """`lines` are dicts already processed by calc_line. When there are no lines
    the bill total is taken from `manual_total`."""
    if not lines:
        total = q2(manual_total or 0)
        return {
            'subtotal': ZERO, 'item_discount': ZERO, 'tax_total': ZERO, 'items_total': ZERO,
            'discount_percent': ZERO, 'discount_amount': ZERO, 'charges_amount': ZERO,
            'round_off': ZERO, 'total': total, 'manual_total': True,
        }
    subtotal = sum((line['gross'] for line in lines), ZERO)
    item_discount = sum((line['discount_amount'] for line in lines), ZERO)
    tax_total = sum((line['tax_amount'] for line in lines), ZERO)
    items_total = sum((line['amount'] for line in lines), ZERO)

    disc_pct = q2(discount_percent)
    if disc_pct > 0:
        discount = q2(items_total * disc_pct / HUNDRED)
    else:
        discount = q2(discount_amount)
    discount = min(max(discount, ZERO), max(items_total, ZERO))
    charges = max(q2(charges_amount), ZERO)
    pre_round = items_total - discount + charges
    if auto_round_off:
        rounding = round_rupee(pre_round) - pre_round
    else:
        rounding = q2(round_off)
        if abs(rounding) > MAX_ROUND_OFF:
            rounding = MAX_ROUND_OFF if rounding > 0 else -MAX_ROUND_OFF
    total = pre_round + rounding
    return {
        'subtotal': subtotal,
        'item_discount': item_discount,
        'tax_total': tax_total,
        'items_total': items_total,
        'discount_percent': disc_pct if disc_pct > 0 else ZERO,
        'discount_amount': discount,
        'charges_amount': charges,
        'round_off': q2(rounding),
        'total': q2(total),
        'manual_total': False,
    }


def D_or_zero(value):
    try:
        return D(value)
    except ValueError:
        return ZERO
