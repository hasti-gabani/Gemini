"""Generate bill-calculation test vectors from the backend's calc.py.

    backend/venv/Scripts/python.exe frontend/scripts/gen_calc_vectors.py
"""
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))

from transactions.calc import calc_bill, calc_line  # noqa: E402

random.seed(20260916)


def rnd_decimal(max_whole, max_places, allow_extra=True):
    whole = random.randint(0, max_whole)
    places = random.randint(0, max_places + (1 if allow_extra and random.random() < 0.3 else 0))
    frac = ''.join(random.choice('0123456789') for _ in range(places))
    if random.random() < 0.15 and places:
        frac = frac[:-1] + '5'  # exercise half-up ties
    return f'{whole}.{frac}' if frac else str(whole)


cases = []
for _ in range(3000):
    lines = []
    for _ in range(random.randint(0, 6)):
        pct = random.random() < 0.4
        lines.append({
            'quantity': rnd_decimal(random.choice([5, 50, 2000]), 3),
            'rate': rnd_decimal(random.choice([100, 5000, 250000]), 2),
            'discount_percent': rnd_decimal(40, 2) if pct else '0',
            'discount_amount': '0' if pct else (rnd_decimal(500, 2) if random.random() < 0.3 else '0'),
            'tax_rate': random.choice(['0', '0', '3', '5', '12', '18', '28', '0.25', '12.5']),
            'tax_inclusive': random.random() < 0.3,
        })
    options = {
        'discount_percent': rnd_decimal(25, 2) if random.random() < 0.25 else '0',
        'discount_amount': rnd_decimal(900, 2) if random.random() < 0.25 else '0',
        'charges_amount': rnd_decimal(700, 2) if random.random() < 0.3 else '0',
        'auto_round_off': random.random() < 0.7,
        'round_off': random.choice(['0', '0.37', '-0.42', '1.5', '-2', '0.99']),
        'manual_total': rnd_decimal(99999, 2),
    }
    computed = [calc_line(**line) for line in lines]
    bill = calc_bill(computed, **options)
    cases.append({
        'lines': lines,
        'options': options,
        'expected_lines': [{k: str(v) for k, v in c.items() if k in ('gross', 'discount_amount', 'taxable_amount', 'tax_amount', 'amount')} for c in computed],
        'expected': {k: (str(v) if not isinstance(v, bool) else v) for k, v in bill.items()},
    })

out = Path(__file__).with_name('calc-vectors.json')
out.write_text(json.dumps(cases), encoding='utf-8')
print(f'wrote {len(cases)} cases to {out.name}')
