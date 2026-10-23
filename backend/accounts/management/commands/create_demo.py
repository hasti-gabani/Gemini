"""Create a demo business with realistic sample data.

    python manage.py create_demo                 # user "demo" / password "demo1234"
    python manage.py create_demo --reset         # delete the demo business first
"""
import random
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import User
from accounts.services import bootstrap_business
from banking import services as bank_services
from banking.models import BankAccount, BankAdjustment
from core.dates import today
from inventory import services as item_services
from inventory.models import Category, Item
from parties import services as party_services
from parties.models import Party, Reminder
from transactions import services as txn_services

CUSTOMERS = [
    ('Ghanshyambhai Nana', '9825012345', 'Rajkot'), ('Office Cpp Contact', '9879001122', 'Rajkot'),
    ('SRTM Vishal Bhai', '9909123456', 'Morbi'), ('Mayank Darbar', '9824598765', 'Jamnagar'),
    ('IMCQ Pranjal Delhi', '9811022334', 'Delhi'), ('SRTM Dharmesh Gabani', '9723456789', 'Surat'),
    ('SRTM Akshar Kevadiya', '9638527410', 'Amreli'), ('Kaushalbhai Patel', '9427001234', 'Gondal'),
    ('રમેશભાઈ પટેલ', '9998887776', 'Junagadh'),
]
SUPPLIERS = [
    ('Solar Distributors Ahmedabad', '9099001100', 'Ahmedabad'),
    ('Kirtan Electricals Surat', '9016123123', 'Surat'),
    ('Transport Nandan Courier', '9265432100', 'Rajkot'),
]
ITEMS = [
    # name, category, unit, sale, purchase, tax, opening, low
    ('Panel 90 W', 'Solar Panels', 'PCS', 50, 38, 12, 400, 50),
    ('Solar Panel 335W Mono', 'Solar Panels', 'PCS', 9800, 8400, 12, 40, 8),
    ('Inverter 1 kVA', 'Inverters', 'PCS', 6200, 5100, 18, 15, 3),
    ('Battery 150Ah Tubular', 'Batteries', 'PCS', 13500, 11800, 28, 12, 3),
    ('DC Wire 4 sq mm', 'Wires & Cables', 'MTR', 42, 33, 18, 1500, 200),
    ('MC4 Connector', 'Accessories', 'PAIR', 90, 55, 18, 300, 40),
    ('Mounting Structure', 'Accessories', 'SET', 3200, 2600, 18, 20, 4),
    ('LED Bulb 9W', 'Accessories', 'PCS', 110, 72, 12, 250, 30),
    ('Earthing Kit', 'Accessories', 'SET', 1450, 1100, 18, 10, 5),
    ('Charge Controller 30A', 'Inverters', 'PCS', 1850, 1420, 18, 6, 4),
]


class Command(BaseCommand):
    help = 'Create a demo business with sample customers, items, bills and payments.'

    def add_arguments(self, parser):
        parser.add_argument('--username', default='demo')
        parser.add_argument('--password', default='demo1234')
        parser.add_argument('--reset', action='store_true', help='Delete the existing demo user and business first.')
        parser.add_argument('--seed', type=int, default=7)

    def handle(self, *args, **options):
        username = options['username']
        existing = User.objects.filter(username=username).first()
        if existing:
            if not options['reset']:
                raise CommandError(f'User "{username}" already exists. Use --reset to recreate the demo data.')
            business = existing.business
            existing.delete()
            if business:
                from datamgmt.backup import wipe_business_data
                with transaction.atomic():
                    wipe_business_data(business)
                    business.delete()
        random.seed(options['seed'])
        with transaction.atomic():
            user = self._create(username, options['password'])
        self.stdout.write(self.style.SUCCESS(
            f'Demo business "{user.business.name}" created. Sign in with {username} / {options["password"]}'))

    def _create(self, username, password):
        business = bootstrap_business(
            'Shree Hari Solar & Electricals', phone='9876501234', email='accounts@shreehari.example',
            address='12, Gundawadi Main Road', city='Rajkot', state='Gujarat', pincode='360002',
            gstin='24ABCDE1234F1Z5')
        user = User.objects.create_user(username=username, password=password, first_name='Hari', last_name='Patel',
                                        phone='9876501234', business=business, role=User.ROLE_OWNER)
        t = today()

        cash = txn_services.cash_account(business)
        cash.opening_balance = Decimal('15000')
        cash.opening_date = t - timedelta(days=90)
        bank_services.save_account(cash)
        hdfc = bank_services.ensure_single_bank(business)  # the one bank account, B
        for key, value in dict(
                bank_name='HDFC Bank', account_name='Shree Hari Solar & Electricals', account_number='50200012344521',
                ifsc='HDFC0000123', branch='Kalawad Road, Rajkot', upi_id='shreehari@hdfcbank',
                opening_balance=Decimal('450000'), opening_date=t - timedelta(days=90), print_on_invoice=True).items():
            setattr(hdfc, key, value)
        hdfc = bank_services.save_account(hdfc)

        categories = {}
        items = []
        for name, category, unit, sale, purchase, tax, opening, low in ITEMS:
            if category not in categories:
                categories[category] = Category.objects.create(business=business, name=category)
            items.append(item_services.save_item(Item(
                business=business, name=name, category=categories[category], unit=unit,
                sale_price=Decimal(sale), purchase_price=Decimal(purchase), tax_rate=Decimal(tax),
                opening_stock=Decimal(opening), low_stock_limit=Decimal(low),
                code=f'SH{100 + len(items)}')))

        customers = []
        for index, (name, phone, city) in enumerate(CUSTOMERS):
            opening = Decimal(random.choice([0, 0, 0, 1500, 2500]))
            customers.append(party_services.save_party(Party(
                business=business, name=name, phone=phone, city=city, state='Gujarat' if city != 'Delhi' else 'Delhi',
                party_type=Party.TYPE_CUSTOMER, opening_balance=opening,
                opening_balance_date=t - timedelta(days=90))))
        suppliers = [party_services.save_party(Party(
            business=business, name=name, phone=phone, city=city, state='Gujarat', party_type=Party.TYPE_SUPPLIER))
            for name, phone, city in SUPPLIERS]

        accounts = [cash, hdfc]

        # Purchases first so stock is available
        for days_ago in (80, 62, 45, 30, 12, 3):
            supplier = random.choice(suppliers[:2])
            lines = [{'item': item, 'quantity': Decimal(random.choice([5, 10, 20])), 'rate': item.purchase_price,
                      'tax_rate': item.tax_rate} for item in random.sample(items, 3)]
            date = t - timedelta(days=days_ago)
            bill = txn_services.save_bill('purchase', business, user, {
                'party': supplier, 'date': date, 'mode': 'credit', 'items': lines,
                'received_amount': Decimal('0'), 'notes': 'Delivered at godown'})
            paid = (bill.total * Decimal(random.choice(['0', '0.5', '1']))).quantize(Decimal('1'))
            if paid:
                txn_services.save_payment('out', business, user, {
                    'party': supplier, 'amount': paid, 'account': hdfc,
                    'date': date + timedelta(days=2), 'reference_no': f'NEFT{random.randint(100000, 999999)}'})

        # Sales over the last ~75 days
        for number in range(34):
            days_ago = max(0, round(75 - number * 75 / 33) - random.randint(0, 1))
            date = t - timedelta(days=days_ago)
            customer = random.choice(customers)
            mode = 'cash' if random.random() < 0.25 else 'credit'
            lines = []
            for item in random.sample(items, random.choice([1, 1, 2, 3])):
                qty = Decimal(random.choice([1, 2, 4, 10])) if item.unit not in ('MTR',) else Decimal(
                    random.choice([25, 50, 100]))
                lines.append({'item': item, 'quantity': qty, 'rate': item.sale_price,
                              'discount_percent': Decimal(random.choice([0, 0, 0, 5])), 'tax_rate': item.tax_rate})
            data = {'party': customer, 'date': date, 'mode': mode, 'items': lines,
                    'due_date': date + timedelta(days=15) if mode == 'credit' else None,
                    'notes': random.choice(['', '', 'Installation included', 'Delivery within 2 days'])}
            if mode == 'credit' and random.random() < 0.5:
                data['received_amount'] = Decimal(random.choice([1000, 2000, 5000]))
                data['payment_account'] = random.choice(accounts)
            try:
                txn_services.save_bill('sale', business, user, data)
            except Exception:
                data['received_amount'] = Decimal('0')
                txn_services.save_bill('sale', business, user, data)

        # Later payments from customers (FIFO against their bills)
        for customer in customers:
            customer.refresh_from_db()
            if customer.balance <= 0 or random.random() < 0.3:
                continue
            amount = (customer.balance * Decimal(random.choice(['0.4', '0.6', '1']))).quantize(Decimal('1'))
            if amount > 0:
                txn_services.save_payment('in', business, user, {
                    'party': customer, 'amount': amount, 'account': random.choice(accounts),
                    'date': t - timedelta(days=random.randint(0, 20)),
                    'reference_no': random.choice(['', f'UPI{random.randint(10**9, 10**10 - 1)}'])})

        bank_services.save_adjustment(BankAdjustment(
            business=business, txn_type=BankAdjustment.TYPE_DEPOSIT, amount=Decimal('10000'), from_account=cash,
            to_account=hdfc, date=t - timedelta(days=10), description='Cash deposited', created_by=user))

        for customer in customers:
            customer.refresh_from_db()
        pending = sorted((c for c in customers if c.balance > 0), key=lambda c: -c.balance)[:3]
        for offset, customer in enumerate(pending):
            from parties.reminders import render_message
            due = t + timedelta(days=offset - 1)
            Reminder.objects.create(business=business, party=customer, amount=customer.balance, due_date=due,
                                    message=render_message(business, customer, customer.balance, due))
        return user
