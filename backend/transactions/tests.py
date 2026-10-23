"""End-to-end API tests for the accounting workflow."""
import io
import os
import shutil
import tempfile
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from core.dates import add_months, today

MEDIA = tempfile.mkdtemp(prefix='ts-test-media-')


def png_bytes():
    buffer = io.BytesIO()
    Image.new('RGB', (40, 30), (20, 120, 200)).save(buffer, format='PNG')
    return buffer.getvalue()


@override_settings(MEDIA_ROOT=MEDIA, ALLOW_REGISTRATION=True)
class WorkflowTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()  # sign-in rate limits are per test, not per test run
        self.client = APIClient()
        r = self.client.post('/api/auth/register/', {
            'name': 'Hari Patel', 'business_name': 'Hari Traders', 'phone': '9876543210', 'password': 'strong-pass-91',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(r.data['authenticated'])
        self.cash = next(a for a in self.get('/api/accounts/')['results'] if a['kind'] == 'cash')
        self.assertEqual(self.cash['kind'], 'cash')

    # ------------------------------------------------------------------ helpers

    def get(self, url, status=200, **params):
        r = self.client.get(url, params)
        self.assertEqual(r.status_code, status, r.content[:2000])
        return r.data if status == 200 else r

    def post(self, url, data, status=201, fmt='json'):
        r = self.client.post(url, data, format=fmt)
        self.assertEqual(r.status_code, status, r.content[:2000])
        return r.data

    def put(self, url, data, status=200):
        r = self.client.put(url, data, format='json')
        self.assertEqual(r.status_code, status, r.content[:2000])
        return r.data

    def delete(self, url, status=204):
        r = self.client.delete(url)
        self.assertEqual(r.status_code, status, r.content[:2000])
        return r

    def party(self, pid):
        return self.get(f'/api/parties/{pid}/')

    def account(self, aid):
        return next(a for a in self.get('/api/accounts/')['results'] if a['id'] == aid)

    def setup_masters(self):
        customer = self.post('/api/parties/', {'name': 'Ghanshyambhai Nana', 'phone': '98250 12345',
                                               'city': 'Rajkot', 'party_type': 'customer'})
        bank = next(a for a in self.get('/api/accounts/')['results'] if a['kind'] == 'bank')
        bank = self.client.patch(f'/api/accounts/{bank["id"]}/', {
            'bank_name': 'HDFC Bank', 'account_number': '50100012341234', 'ifsc': 'HDFC0001234', 'opening_balance': '0',
        }, format='json').data
        item = self.post('/api/items/', {'name': 'Panel 90 W', 'unit': 'pcs', 'sale_price': '500',
                                         'purchase_price': '400', 'opening_stock': '100', 'low_stock_limit': '10'},
                         fmt='multipart')
        return customer, bank, item

    # ------------------------------------------------------------------ the main workflow

    def test_full_customer_workflow(self):
        customer, bank, item = self.setup_masters()
        self.assertEqual(customer['phone'], '9825012345')
        self.assertEqual(bank['name'], 'B')
        self.assertEqual(item['current_stock'], '100.000')
        self.assertEqual(item['unit'], 'PCS')

        number = self.get('/api/next-number/', type='sale')['number']
        self.assertEqual(number, 'Bil.1')

        sale = self.post('/api/sales/', {
            'party': customer['id'], 'mode': 'credit',
            'items': [{'item': item['id'], 'quantity': '20', 'rate': '500'}],
            'notes': 'Delivery by Friday',
        })
        self.assertEqual(sale['number'], 'Bil.1')
        self.assertEqual(sale['total'], '10000.00')
        self.assertEqual(sale['payment_status'], 'unpaid')
        self.assertEqual(sale['terms'].split('\n')[0], '1. Goods once sold will not be taken back or exchanged.')
        self.assertEqual(self.party(customer['id'])['balance'], '10000.00')
        self.assertEqual(self.get(f'/api/items/{item["id"]}/')['current_stock'], '80.000')

        # Payment In of 5,000 to the bank with a screenshot
        upload = self.client.post('/api/attachments/', {
            'file': SimpleUploadedFile('upi-screenshot.png', png_bytes(), content_type='image/png')},
            format='multipart')
        self.assertEqual(upload.status_code, 201, upload.content)
        pending = self.get(f'/api/parties/{customer["id"]}/pending-bills/', kind='in')
        self.assertEqual(pending['outstanding'], '10000.00')
        self.assertEqual(len(pending['results']), 1)

        pay1 = self.post('/api/payments-in/', {
            'party': customer['id'], 'amount': '5000', 'account': bank['id'], 'reference_no': 'UTR123456',
            'attachment_ids': [upload.data['id']],
        })
        self.assertEqual(pay1['number'], 'Receipt 1')
        self.assertEqual(pay1['allocations'][0]['number'], 'Bil.1')
        self.assertEqual(len(pay1['attachments']), 1)
        self.assertEqual(self.get(f'/api/sales/{sale["id"]}/')['payment_status'], 'partial')
        self.assertEqual(self.get(f'/api/sales/{sale["id"]}/')['balance_due'], '5000.00')
        self.assertEqual(self.party(customer['id'])['balance'], '5000.00')
        self.assertEqual(self.account(bank['id'])['current_balance'], '5000.00')

        dashboard = self.get('/api/dashboard/')
        self.assertEqual(dashboard['receivable'], '5000.00')
        self.assertEqual(dashboard['bank_balance'], '5000.00')
        self.assertEqual(dashboard['today_sale'], '10000.00')

        statement = self.get(f'/api/parties/{customer["id"]}/statement/')
        self.assertEqual([r['type'] for r in statement['rows']], ['sale', 'payment_in'])
        self.assertEqual(statement['rows'][0]['balance'], '10000.00')
        self.assertEqual(statement['rows'][1]['balance'], '5000.00')
        self.assertEqual(statement['closing_balance'], '5000.00')

        # Take Payment: remaining 5,000 in cash against the bill
        pay2 = self.post('/api/payments-in/', {
            'party': customer['id'], 'amount': '5000', 'account': self.cash['id'],
            'allocations': [{'bill': sale['id'], 'amount': '5000'}],
        })
        detail = self.get(f'/api/sales/{sale["id"]}/')
        self.assertEqual(detail['payment_status'], 'paid')
        self.assertEqual(detail['balance_due'], '0.00')
        self.assertEqual([p['amount'] for p in detail['payments']], ['5000.00', '5000.00'])
        self.assertEqual(self.party(customer['id'])['balance'], '0.00')
        self.assertEqual(self.account(self.cash['id'])['current_balance'], '0.00')  # Cash is never used: money goes to B

        report = self.get('/api/reports/sales/', period='today')
        totals = {s['label']: s['value'] for s in report['summary']}
        self.assertEqual(totals['Total Sales'], '10000.00')
        self.assertEqual(totals['Total Received'], '10000.00')
        self.assertEqual(totals['Total Pending'], '0.00')

        # Editing the bill below what was already paid is refused
        r = self.client.put(f'/api/sales/{sale["id"]}/', {
            'party': customer['id'], 'items': [{'item': item['id'], 'quantity': '10', 'rate': '500'}]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('total', r.data['errors'])

        # Deleting the second payment re-opens the bill
        self.delete(f'/api/payments-in/{pay2["id"]}/')
        self.assertEqual(self.get(f'/api/sales/{sale["id"]}/')['payment_status'], 'partial')
        self.assertEqual(self.party(customer['id'])['balance'], '5000.00')
        self.assertEqual(self.account(self.cash['id'])['current_balance'], '0.00')

        # Delete the sale together with its payments: everything returns to the start
        preview = self.get(f'/api/sales/{sale["id"]}/delete-preview/')
        self.assertEqual(len(preview['linked_payments']), 1)
        self.delete(f'/api/sales/{sale["id"]}/?delete_linked_payments=1')
        self.assertEqual(self.party(customer['id'])['balance'], '0.00')
        self.assertEqual(self.account(bank['id'])['current_balance'], '0.00')
        self.assertEqual(self.get(f'/api/items/{item["id"]}/')['current_stock'], '100.000')
        self.assertEqual(self.get('/api/payments-in/')['count'], 0)

    def test_received_with_bill_and_edit(self):
        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {
            'party': customer['id'], 'items': [{'item': item['id'], 'quantity': '2', 'rate': '250',
                                                'discount_percent': '10', 'tax_rate': '18'}],
            'received_amount': '200', 'payment_account': bank['id'], 'payment_reference': 'UPI-77',
        })
        # 2 x 250 = 500, 10% disc = 450, 18% tax = 81 -> 531
        self.assertEqual(sale['total'], '531.00')
        self.assertEqual(sale['origin_payment']['amount'], '200.00')
        self.assertEqual(sale['payment_status'], 'partial')
        self.assertEqual(self.account(bank['id'])['current_balance'], '200.00')
        self.assertEqual(self.party(customer['id'])['balance'], '331.00')

        edited = self.put(f'/api/sales/{sale["id"]}/', {
            'party': customer['id'], 'items': [{'item': item['id'], 'quantity': '4', 'rate': '250'}],
            'received_amount': '1000', 'payment_account': self.cash['id'],
        })
        self.assertEqual(edited['total'], '1000.00')
        self.assertEqual(edited['payment_status'], 'paid')
        self.assertEqual(edited['number'], 'Bil.1')
        self.assertEqual(self.account(bank['id'])['current_balance'], '1000.00')  # sent as Cash, kept in B
        self.assertEqual(self.account(self.cash['id'])['current_balance'], '0.00')
        self.assertEqual(self.party(customer['id'])['balance'], '0.00')
        self.assertEqual(self.get(f'/api/items/{item["id"]}/')['current_stock'], '96.000')

        # Received amount cannot exceed the bill
        r = self.client.put(f'/api/sales/{sale["id"]}/', {
            'party': customer['id'], 'items': [{'item': item['id'], 'quantity': '1', 'rate': '100'}],
            'received_amount': '500'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('received_amount', r.data['errors'])

    def test_cash_sale_without_party_and_manual_total(self):
        sale = self.post('/api/sales/', {'mode': 'cash', 'total': '750', 'party_name': 'Walk-in'})
        self.assertEqual(sale['payment_status'], 'paid')
        bank = next(a for a in self.get('/api/accounts/')['results'] if a['kind'] == 'bank')
        self.assertEqual(bank['current_balance'], '750.00')  # money received goes to the bank (B), not Cash
        self.assertEqual(self.account(self.cash['id'])['current_balance'], '0.00')
        r = self.client.post('/api/sales/', {'mode': 'credit', 'total': '750'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('party', r.data['errors'])

    def test_validation_messages(self):
        customer, bank, item = self.setup_masters()
        r = self.client.post('/api/parties/', {'name': ''}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['errors']['name'], 'Party name is required.')
        r = self.client.post('/api/parties/', {'name': 'ghanshyambhai nana'}, format='json')
        self.assertIn('already exists', r.data['errors']['name'])
        r = self.client.post('/api/parties/', {'name': 'X', 'phone': '12345'}, format='json')
        self.assertIn('mobile', r.data['errors']['phone'])
        r = self.client.post('/api/sales/', {'party': customer['id'],
                                             'items': [{'item': item['id'], 'quantity': '0', 'rate': '5'}]},
                             format='json')
        self.assertEqual(r.data['errors']['items.0.quantity'], 'Quantity must be greater than 0.')
        self.post('/api/sales/', {'party': customer['id'], 'number': 'Bil.9', 'total': '100'})
        r = self.client.post('/api/sales/', {'party': customer['id'], 'number': 'bil.9', 'total': '100'},
                             format='json')
        self.assertIn('already exists', r.data['errors']['number'])
        # auto numbering continues after a manually typed number
        self.assertEqual(self.get('/api/next-number/', type='sale')['number'], 'Bil.10')
        r = self.client.post('/api/accounts/', {'bank_name': 'SBI'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('Only one bank account', r.data['detail'])
        r = self.client.post('/api/payments-in/', {'party': customer['id'], 'amount': 'abc'}, format='json')
        self.assertEqual(r.status_code, 400)
        # A payment bigger than the pending amount saves directly; the extra stays as an advance
        advance = self.post('/api/payments-in/', {'party': customer['id'], 'amount': '150'})
        self.assertEqual(advance['unallocated_amount'], '50.00')
        self.assertEqual(self.party(customer['id'])['balance'], '-50.00')

    def test_advance_payments_need_no_confirmation(self):
        customer, bank, item = self.setup_masters()
        self.assertEqual(self.party(customer['id'])['balance'], '0.00')
        paid_in = self.post('/api/payments-in/', {'party': customer['id'], 'amount': '500'})
        self.assertEqual(paid_in['unallocated_amount'], '500.00')
        self.assertEqual(self.party(customer['id'])['balance'], '-500.00')
        supplier = self.post('/api/parties/', {'name': 'Solar Distributors', 'party_type': 'supplier'})
        paid_out = self.post('/api/payments-out/', {'party': supplier['id'], 'amount': '700',
                                                    'account': self.cash['id']})
        self.assertEqual(paid_out['unallocated_amount'], '700.00')
        self.assertEqual(self.party(supplier['id'])['balance'], '700.00')

    def test_bill_mode_follows_received_amount(self):
        customer, bank, item = self.setup_masters()
        line = [{'item': item['id'], 'quantity': '2', 'rate': '500'}]
        full = self.post('/api/sales/', {'party': customer['id'], 'items': line, 'received_amount': '1000'})
        self.assertEqual((full['mode'], full['payment_status']), ('cash', 'paid'))
        half = self.post('/api/sales/', {'party': customer['id'], 'items': line, 'received_amount': '500'})
        self.assertEqual((half['mode'], half['balance_due']), ('credit', '500.00'))
        unpaid = self.post('/api/sales/', {'party': customer['id'], 'items': line})
        self.assertEqual((unpaid['mode'], unpaid['payment_status']), ('credit', 'unpaid'))
        self.assertEqual(self.party(customer['id'])['balance'], '1500.00')
        # A walk-in bill is fine when fully received, but a bill with money due needs a customer
        walk_in = self.post('/api/sales/', {'items': line, 'received_amount': '1000', 'party_name': 'Counter'})
        self.assertEqual((walk_in['mode'], walk_in['party']), ('cash', None))
        r = self.client.post('/api/sales/', {'items': line, 'received_amount': '400'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('party', r.data['errors'])
        # Editing: receiving the rest turns the bill into a cash bill...
        edited = self.put(f'/api/sales/{half["id"]}/', {'party': customer['id'], 'items': line,
                                                         'received_amount': '1000'})
        self.assertEqual((edited['mode'], edited['balance_due']), ('cash', '0.00'))
        # ...but a bill with a separately linked payment keeps its mode
        self.post('/api/payments-in/', {'party': customer['id'], 'amount': '300',
                                        'allocations': [{'bill': unpaid['id'], 'amount': '300'}]})
        kept = self.put(f'/api/sales/{unpaid["id"]}/', {'party': customer['id'], 'items': line,
                                                         'received_amount': '700'})
        self.assertEqual((kept['mode'], kept['payment_status']), ('credit', 'paid'))

    def test_new_bills_have_no_due_date_and_old_ones_keep_it(self):
        customer, bank, item = self.setup_masters()
        r = self.client.patch('/api/settings/', {'credit_period_days': 15}, format='json')
        self.assertEqual(r.status_code, 200)
        line = [{'item': item['id'], 'quantity': '1', 'rate': '500'}]
        fresh = self.post('/api/sales/', {'party': customer['id'], 'items': line})
        self.assertIsNone(fresh['due_date'])
        old = self.post('/api/sales/', {'party': customer['id'], 'items': line,
                                        'date': (today() - timedelta(days=20)).isoformat(),
                                        'due_date': (today() - timedelta(days=5)).isoformat()})
        self.assertTrue(old['is_overdue'])
        # The form no longer sends a due date: editing keeps the old one, without errors
        edited = self.put(f'/api/sales/{old["id"]}/', {'party': customer['id'], 'items': line,
                                                        'date': old['date']})
        self.assertEqual(edited['due_date'], old['due_date'])
        # If the bill date moves past the hidden due date, the due date is dropped instead of failing
        moved = self.put(f'/api/sales/{old["id"]}/', {'party': customer['id'], 'items': line,
                                                       'date': today().isoformat()})
        self.assertIsNone(moved['due_date'])

    def test_party_transactions_list_merges_bills_and_payments(self):
        customer, bank, item = self.setup_masters()
        day = lambda n: (today() - timedelta(days=n)).isoformat()  # noqa: E731
        sale = self.post('/api/sales/', {'party': customer['id'], 'date': day(5), 'total': '1000'})
        purchase = self.post('/api/purchases/', {'party': customer['id'], 'date': day(3), 'total': '400'})
        paid_in = self.post('/api/payments-in/', {'party': customer['id'], 'date': day(2), 'amount': '600',
                                                  'account': bank['id']})
        paid_out = self.post('/api/payments-out/', {'party': customer['id'], 'date': day(1), 'amount': '400',
                                                    'account': self.cash['id']})
        url = f'/api/parties/{customer["id"]}/transactions/'
        everything = self.get(url)
        self.assertEqual(everything['count'], 4)
        self.assertEqual([(r['type'], r['id']) for r in everything['results']], [
            ('payment_out', paid_out['id']), ('payment_in', paid_in['id']),
            ('purchase', purchase['id']), ('sale', sale['id'])])
        self.assertEqual(everything['results'][1]['against'], [sale['number']])
        self.assertEqual(everything['results'][3]['balance_due'], '400.00')
        bills = self.get(url, filter='bills')
        self.assertEqual([r['type'] for r in bills['results']], ['purchase', 'sale'])
        by_status = lambda value: self.client.get(url, {'filter': 'bills', 'status': value}).data  # noqa: E731
        self.assertEqual(by_status('partial')['count'], 1)
        self.assertEqual(by_status('paid')['results'][0]['id'], purchase['id'])
        payments = self.get(url, filter='payments')
        self.assertEqual([r['type'] for r in payments['results']], ['payment_out', 'payment_in'])
        first = self.get(url, page_size=3)
        self.assertEqual((len(first['results']), first['next']), (3, 2))
        self.assertEqual(self.get(url, page_size=3, page=2)['results'][0]['type'], 'sale')

    def test_party_becomes_customer_and_supplier_when_used_both_ways(self):
        customer, bank, item = self.setup_masters()
        self.post('/api/purchases/', {'party': customer['id'], 'total': '300'})
        self.assertEqual(self.party(customer['id'])['party_type'], 'both')
        supplier = self.post('/api/parties/', {'name': 'Solar Distributors', 'party_type': 'supplier'})
        self.post('/api/purchases/', {'party': supplier['id'], 'total': '200'})
        self.assertEqual(self.party(supplier['id'])['party_type'], 'supplier')
        self.post('/api/sales/', {'party': supplier['id'], 'total': '100'})
        self.assertEqual(self.party(supplier['id'])['party_type'], 'both')
        # Editing a customer's details never changes the type that bills gave it
        r = self.client.patch(f'/api/parties/{customer["id"]}/', {'city': 'Gondal'}, format='json')
        self.assertEqual((r.data['city'], r.data['party_type']), ('Gondal', 'both'))

    def test_purchase_and_payment_out(self):
        supplier = self.post('/api/parties/', {'name': 'Solar Distributors', 'party_type': 'supplier'})
        item = self.post('/api/items/', {'name': 'Inverter', 'purchase_price': '8000', 'opening_stock': '0'},
                         fmt='multipart')
        purchase = self.post('/api/purchases/', {
            'party': supplier['id'], 'items': [{'item': item['id'], 'quantity': '3', 'rate': '8000'}],
            'received_amount': '4000', 'payment_account': self.cash['id'],
        })
        self.assertEqual(purchase['number'], 'PUR-1')
        self.assertEqual(purchase['balance_due'], '20000.00')
        self.assertEqual(self.party(supplier['id'])['balance'], '-20000.00')
        self.assertEqual(self.get(f'/api/items/{item["id"]}/')['current_stock'], '3.000')
        bank = next(a for a in self.get('/api/accounts/')['results'] if a['kind'] == 'bank')
        self.assertEqual(bank['current_balance'], '-4000.00')  # sent as Cash, paid from B
        self.assertEqual(self.account(self.cash['id'])['current_balance'], '0.00')
        out = self.post('/api/payments-out/', {'party': supplier['id'], 'amount': '20000', 'account': self.cash['id']})
        self.assertEqual(out['number'], 'Voucher 2')  # Voucher 1 = paid with the purchase
        self.assertEqual(self.get(f'/api/purchases/{purchase["id"]}/')['payment_status'], 'paid')
        self.assertEqual(self.party(supplier['id'])['balance'], '0.00')
        self.assertEqual(self.get('/api/dashboard/')['payable'], '0.00')
        report = self.get('/api/reports/supplier_statement/', party=supplier['id'], period='all')
        self.assertEqual(report['rows'][-1]['balance'], '0.00')

    def test_bank_account_edit_delete_and_transfers(self):
        banks = [a for a in self.get('/api/accounts/')['results'] if a['kind'] == 'bank']
        self.assertEqual([b['name'] for b in banks], ['B'])  # every business has exactly one bank, B
        bank = self.client.patch(f'/api/accounts/{banks[0]["id"]}/', {'opening_balance': '1000'}, format='json').data
        self.assertEqual(bank['current_balance'], '1000.00')
        edited = self.client.patch(f'/api/accounts/{bank["id"]}/', {'opening_balance': '1500', 'name': 'SBI Current'},
                                   format='json')
        self.assertEqual(edited.data['current_balance'], '1500.00')
        self.assertEqual(edited.data['name'], 'B')  # the name always stays B
        self.post('/api/bank-adjustments/', {'txn_type': 'withdraw', 'amount': '500', 'from_account': bank['id'],
                                             'to_account': self.cash['id']})
        self.assertEqual(self.account(bank['id'])['current_balance'], '1000.00')
        self.assertEqual(self.account(self.cash['id'])['current_balance'], '500.00')
        txns = self.get(f'/api/accounts/{bank["id"]}/transactions/')
        self.assertEqual(txns['opening_balance'], '1500.00')
        self.assertEqual(txns['total_out'], '500.00')
        self.assertEqual(txns['closing_balance'], '1000.00')
        # B cannot be deleted and no second bank can be added
        r = self.client.delete(f'/api/accounts/{bank["id"]}/')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.client.post('/api/accounts/', {'bank_name': 'ICICI'}, format='json').status_code, 400)
        self.assertEqual(self.account(bank['id'])['current_balance'], '1000.00')
        r = self.client.delete(f'/api/accounts/{self.cash["id"]}/')
        self.assertEqual(r.status_code, 400)

    def test_extra_banks_merge_into_b(self):
        from accounts.models import Business
        from banking.models import BankAccount
        from banking.services import ensure_single_bank

        business = Business.objects.get(name='Hari Traders')
        BankAccount.objects.create(business=business, kind=BankAccount.KIND_BANK, name='Old SBI', bank_name='SBI',
                                   opening_balance='250')
        ensure_single_bank(business)
        banks = [a for a in self.get('/api/accounts/')['results'] if a['kind'] == 'bank']
        self.assertEqual([(b['name'], b['current_balance']) for b in banks], [('B', '250.00')])

    def test_money_is_kept_only_in_bank(self):
        from accounts.models import Business
        from banking.models import BankAccount
        from banking.services import move_cash_to_bank
        from transactions.models import PaymentIn

        customer, bank, item = self.setup_masters()
        # an old screen that still sends Cash in Hand: the money goes to B
        payment = self.post('/api/payments-in/', {'party': customer['id'], 'amount': '200', 'account': self.cash['id']})
        self.assertEqual(payment['account'], bank['id'])
        # older data that is still in Cash (payment and opening cash) is moved into B
        business = Business.objects.get(name='Hari Traders')
        cash = BankAccount.objects.get(id=self.cash['id'])
        PaymentIn.objects.filter(id=payment['id']).update(account=cash)
        cash.opening_balance = 50
        cash.save()
        move_cash_to_bank(business)
        self.assertEqual(self.account(self.cash['id'])['current_balance'], '0.00')
        self.assertEqual(self.account(bank['id'])['current_balance'], '250.00')
        self.assertEqual(PaymentIn.objects.get(id=payment['id']).account_id, bank['id'])
        txns = self.get(f'/api/accounts/{bank["id"]}/transactions/')
        self.assertEqual(txns['closing_balance'], '250.00')

    def test_cleanup_keeps_balances_with_carry_forward(self):
        customer, bank, item = self.setup_masters()
        old = add_months(today(), -4)
        old_sale = self.post('/api/sales/', {'party': customer['id'], 'date': old.isoformat(),
                                             'items': [{'item': item['id'], 'quantity': '5', 'rate': '500'}]})
        self.post('/api/payments-in/', {'party': customer['id'], 'amount': '1000', 'account': bank['id'],
                                        'date': (old + timedelta(days=1)).isoformat()})
        self.post('/api/sales/', {'party': customer['id'], 'items': [{'item': item['id'], 'quantity': '1',
                                                                       'rate': '500'}]})
        before = (self.party(customer['id'])['balance'], self.account(bank['id'])['current_balance'],
                  self.get(f'/api/items/{item["id"]}/')['current_stock'])
        self.assertEqual(before, ('2000.00', '1000.00', '94.000'))
        options = {'older_than': '3m', 'include': ['sales', 'payments_in'], 'carry_forward': True}
        preview = self.post('/api/data/cleanup/preview/', options, status=200)
        self.assertEqual(preview['counts']['sales'], 1)
        self.assertEqual(preview['counts']['payments_in'], 1)
        self.assertEqual(preview['total'], 2)
        result = self.post('/api/data/cleanup/', {**options, 'expected_total': preview['total'],
                                                  'create_backup': False}, status=200)
        self.assertEqual(result['total'], 2)
        after = (self.party(customer['id'])['balance'], self.account(bank['id'])['current_balance'],
                 self.get(f'/api/items/{item["id"]}/')['current_stock'])
        self.assertEqual(before, after)
        self.get(f'/api/sales/{old_sale["id"]}/', status=404)
        self.assertEqual(self.get('/api/sales/')['count'], 1)
        statement = self.get(f'/api/parties/{customer["id"]}/statement/')
        self.assertEqual(statement['opening_balance'], '1500.00')

    def test_backup_restore_roundtrip(self):
        customer, bank, item = self.setup_masters()
        self.post('/api/sales/', {'party': customer['id'], 'items': [{'item': item['id'], 'quantity': '3',
                                                                       'rate': '500'}],
                                  'received_amount': '700', 'payment_account': bank['id']})
        r = self.client.get('/api/data/backup/')
        self.assertEqual(r.status_code, 200)
        content = b''.join(r.streaming_content) if r.streaming else r.content
        self.delete(f'/api/sales/{self.get("/api/sales/")["results"][0]["id"]}/?delete_linked_payments=1')
        upload = SimpleUploadedFile('backup.zip', content, content_type='application/zip')
        restored = self.client.post('/api/data/restore/', {'file': upload, 'confirm': 'RESTORE'}, format='multipart')
        self.assertEqual(restored.status_code, 200, restored.content)
        parties = self.get('/api/parties/')['results']
        self.assertEqual(parties[0]['balance'], '800.00')
        banks = [a for a in self.get('/api/accounts/')['results'] if a['kind'] == 'bank']
        self.assertEqual(banks[0]['current_balance'], '700.00')
        self.assertEqual(self.get('/api/sales/')['results'][0]['number'], 'Bil.1')

    def test_safety_backups_keep_newest_and_download(self):
        business_id = self.get('/api/auth/session/')['business']['id']
        folder = os.path.join(MEDIA, 'backups', f'business_{business_id}')
        shutil.rmtree(folder, ignore_errors=True)  # other tests may have left backups for the same id
        os.makedirs(folder)
        for day in range(1, 6):  # five older backups whose names sort after "before-reset"
            with open(os.path.join(folder, f'before-restore-2020010{day}-101500.zip'), 'wb') as handle:
                handle.write(b'old')
        r = self.client.post('/api/data/reset/', {'confirm': 'DELETE', 'scope': 'transactions'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        backups = self.get('/api/data/safety-backups/')['results']
        self.assertEqual(len(backups), 5)
        self.assertEqual(backups[0]['reason'], 'before-reset')  # the new one is kept, newest first
        self.assertEqual(backups[0]['reason_label'], 'Before deleting all data')
        self.assertNotIn('before-restore-20200101-101500.zip', [b['name'] for b in backups])

        r = self.client.get(f'/api/data/safety-backups/{backups[0]["name"]}/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('attachment', r['Content-Disposition'])
        content = b''.join(r.streaming_content)
        r.close()
        self.assertEqual(content[:2], b'PK')
        for bad in ('..%2F..%2Fdb.sqlite3', 'before-reset-20200101-101500.zip', 'notes.txt'):
            self.assertEqual(self.client.get(f'/api/data/safety-backups/{bad}/').status_code, 404)

    def test_files_are_removed_only_after_commit(self):
        from django.db import transaction

        from transactions.models import Attachment
        upload = self.client.post('/api/attachments/', {
            'file': SimpleUploadedFile('proof.png', png_bytes(), content_type='image/png')}, format='multipart')
        self.assertEqual(upload.status_code, 201, upload.content)
        path = Attachment.objects.get(pk=upload.data['id']).file.path
        self.assertTrue(os.path.exists(path))
        with self.assertRaises(RuntimeError):
            with transaction.atomic():  # e.g. a restore that fails halfway
                Attachment.objects.get(pk=upload.data['id']).delete()
                raise RuntimeError('simulated failure')
        self.assertTrue(Attachment.objects.filter(pk=upload.data['id']).exists())
        self.assertTrue(os.path.exists(path), 'file must survive when the delete is rolled back')
        with self.captureOnCommitCallbacks(execute=True):
            Attachment.objects.get(pk=upload.data['id']).delete()
        self.assertFalse(os.path.exists(path))

    def test_deleting_ticked_bills_and_payments_together(self):
        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {'party': customer['id'], 'mode': 'credit',
                                         'items': [{'item': item['id'], 'quantity': '4', 'rate': '500'}]})
        payment = self.post('/api/payments-in/', {'party': customer['id'], 'amount': '500', 'account': bank['id']})
        cash_sale = self.post('/api/sales/', {'party': customer['id'], 'mode': 'cash',
                                              'payment_account': self.cash['id'],
                                              'items': [{'item': item['id'], 'quantity': '2', 'rate': '500'}]})
        purchase = self.post('/api/purchases/', {'party': customer['id'], 'mode': 'credit',
                                                 'items': [{'item': item['id'], 'quantity': '5', 'rate': '400'}]})
        origin = cash_sale['origin_payment']['id']

        self.post('/api/transactions/bulk-delete/', {'items': []}, status=400)

        # the payment of a cash bill cannot go on its own, and says so instead of failing the call
        result = self.post('/api/transactions/bulk-delete/',
                           {'items': [{'type': 'payment_in', 'id': origin}]}, status=200)
        self.assertEqual(result['deleted'], 0)
        self.assertEqual(result['kept'][0]['number'], cash_sale['origin_payment']['number'])
        self.assertIn(cash_sale['number'], result['kept'][0]['reason'])

        # everything ticked at once, the cash bill's own payment among it
        result = self.post('/api/transactions/bulk-delete/', {'items': [
            {'type': 'payment_in', 'id': origin},
            {'type': 'sale', 'id': cash_sale['id']},
            {'type': 'sale', 'id': sale['id']},
            {'type': 'purchase', 'id': purchase['id']},
            {'type': 'payment_in', 'id': payment['id']},
        ]}, status=200)
        self.assertEqual(result['deleted'], 4)  # the cash bill took its own payment with it
        self.assertEqual(result['kept'], [])
        self.assertEqual(self.party(customer['id'])['balance'], '0.00')
        self.assertEqual(self.get(f'/api/items/{item["id"]}/')['current_stock'], '100.000')
        self.assertEqual(self.account(bank['id'])['current_balance'], '0.00')
        self.assertEqual(self.account(self.cash['id'])['current_balance'], '0.00')
        for url in ('/api/sales/', '/api/purchases/', '/api/payments-in/'):
            self.assertEqual(self.get(url)['count'], 0, url)

    def test_deleting_ticked_parties_together(self):
        customer, bank, item = self.setup_masters()
        spare = self.post('/api/parties/', {'name': 'Spare Party', 'phone': '9898989898'})
        typo = self.post('/api/parties/', {'name': 'Typo Party', 'phone': '9797979797'})
        self.post('/api/sales/', {'party': customer['id'], 'mode': 'credit',
                                  'items': [{'item': item['id'], 'quantity': '1', 'rate': '500'}]})

        self.post('/api/payments-in/', {'party': customer['id'], 'amount': '200', 'account': bank['id']})

        self.post('/api/parties/bulk-delete/', {'ids': []}, status=400)
        result = self.post('/api/parties/bulk-delete/',
                           {'ids': [spare['id'], typo['id'], customer['id']]}, status=200)
        self.assertEqual(result, {'deleted': 3, 'kept': []})  # the party's bill and payment went with it
        self.assertEqual(self.get('/api/parties/')['count'], 0)
        self.assertEqual(self.get('/api/sales/')['count'], 0)
        self.assertEqual(self.get(f'/api/items/{item["id"]}/')['current_stock'], '100.000')
        self.assertEqual(self.account(bank['id'])['current_balance'], '0.00')

    def test_delete_needs_no_pin(self):
        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {'party': customer['id'], 'mode': 'credit',
                                         'items': [{'item': item['id'], 'quantity': '1', 'rate': '500'}]})
        self.assertNotIn('delete_pin', self.get('/api/settings/'))
        self.delete(f'/api/sales/{sale["id"]}/')
        self.delete(f'/api/parties/{customer["id"]}/')
        self.assertEqual(self.get('/api/sales/')['count'], 0)

    def test_business_isolation(self):
        customer, bank, item = self.setup_masters()
        other = APIClient()
        r = other.post('/api/auth/register/', {'name': 'Other', 'business_name': 'Other Co', 'email': 'o@example.com',
                                                'password': 'another-pass-12'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(other.get(f'/api/parties/{customer["id"]}/').status_code, 404)
        self.assertEqual(other.get('/api/parties/').data['count'], 0)
        r = other.post('/api/sales/', {'party': customer['id'], 'total': '10'}, format='json')
        self.assertEqual(r.status_code, 400)
        anonymous = APIClient()
        self.assertEqual(anonymous.get('/api/parties/').status_code, 403)

    def test_documents_in_every_paper_size(self):
        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {'party': customer['id'], 'received_amount': '100', 'payment_account': bank['id'],
                                         'items': [{'item': item['id'], 'quantity': '2', 'rate': '500'}]})
        payment_id = sale['payments'][0]['id']
        for paper in ('a4', 'a5', 'thermal80', 'thermal58'):
            for url in (f'/api/sales/{sale["id"]}/pdf/', f'/api/payments-in/{payment_id}/pdf/'):
                r = self.client.get(url, {'format': paper, 'download': 1})
                self.assertEqual(r.status_code, 200, f'{url} {paper}')
                self.assertEqual(r['Content-Type'], 'application/pdf')
                self.assertTrue(r.content.startswith(b'%PDF'))
        document = self.get(f'/api/sales/{sale["id"]}/document/')
        self.assertEqual(document['total'], '₹1,000.00')
        self.assertEqual(document['meta'][0], {'label': 'Estimate No.', 'value': 'Bil.1'})
        self.assertEqual(document['party_balances'], [{'label': 'Previous Balance', 'value': '₹0.00'},
                                                      {'label': 'Current Balance', 'value': '₹900.00'}])
        second = self.post('/api/sales/', {'party': customer['id'], 'mode': 'credit',
                                           'items': [{'item': item['id'], 'quantity': '1', 'rate': '305'}]})
        document = self.get(f'/api/sales/{second["id"]}/document/')
        self.assertEqual([row['value'] for row in document['party_balances']], ['₹900.00', '₹1,205.00'])
        cash_sale = self.post('/api/sales/', {'items': [{'item': item['id'], 'quantity': '1', 'rate': '500'}],
                                              'received_amount': '500', 'payment_account': self.cash['id']})
        self.assertEqual(self.get(f'/api/sales/{cash_sale["id"]}/document/')['party_balances'], [])

    @override_settings(WHATSAPP_TOKEN='test-token', WHATSAPP_PHONE_NUMBER_ID='1234567890',
                       WHATSAPP_TEMPLATE='invoice_pdf', WHATSAPP_TEMPLATE_LANGUAGE='en',
                       WHATSAPP_TEMPLATE_PARAMS=['party', 'number', 'amount'])
    def test_whatsapp_sends_pdf_to_party_number(self):
        import json
        from unittest import mock

        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {'party': customer['id'],
                                         'items': [{'item': item['id'], 'quantity': '2', 'rate': '500'}]})
        self.assertTrue(self.get(f'/api/sales/{sale["id"]}/share/')['whatsapp_api'])
        sent = []

        class Reply:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return json.dumps(self.body).encode()

        def fake_urlopen(request, timeout=None):
            sent.append(request)
            return Reply({'id': 'media-1'} if request.full_url.endswith('/media') else {'messages': [{'id': 'wamid.1'}]})

        with mock.patch('core.whatsapp.urlopen', fake_urlopen):
            result = self.post(f'/api/sales/{sale["id"]}/whatsapp/', {}, status=200)
        self.assertEqual(result['detail'], 'PDF sent on WhatsApp to +919825012345.')
        upload, message = sent
        self.assertEqual(upload.full_url, 'https://graph.facebook.com/v21.0/1234567890/media')
        self.assertEqual(upload.get_header('Authorization'), 'Bearer test-token')
        self.assertIn(b'%PDF', upload.data)
        body = json.loads(message.data)
        self.assertEqual(body['to'], '919825012345')
        self.assertEqual(body['template']['name'], 'invoice_pdf')
        header, params = body['template']['components']
        self.assertEqual(header['parameters'][0]['document']['id'], 'media-1')
        self.assertTrue(header['parameters'][0]['document']['filename'].endswith('.pdf'))
        self.assertEqual([p['text'] for p in params['parameters']], ['Ghanshyambhai Nana', sale['number'], '₹1,000.00'])

        # a party without a mobile number gets a clear message and nothing is sent
        walkin = self.post('/api/sales/', {'items': [{'item': item['id'], 'quantity': '1', 'rate': '500'}],
                                           'received_amount': '500'})
        with mock.patch('core.whatsapp.urlopen', fake_urlopen):
            r = self.client.post(f'/api/sales/{walkin["id"]}/whatsapp/', {}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('no mobile number', r.data['detail'])
        self.assertEqual(len(sent), 2)

    @override_settings(WHATSAPP_DESKTOP=True)
    def test_whatsapp_desktop_sends_pdf_to_party_number(self):
        from pathlib import Path
        from types import SimpleNamespace
        from unittest import mock

        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {'party': customer['id'],
                                         'items': [{'item': item['id'], 'quantity': '1', 'rate': '500'}]})
        runs = []

        def fake_run(args, **kwargs):
            runs.append(args)
            return SimpleNamespace(returncode=0, stdout='', stderr='')

        with mock.patch('core.whatsapp_desktop.is_available', return_value=True):
            self.assertTrue(self.get(f'/api/sales/{sale["id"]}/share/')['whatsapp_api'])
            with mock.patch('core.whatsapp_desktop.subprocess.run', fake_run):
                result = self.post(f'/api/sales/{sale["id"]}/whatsapp/', {}, status=200)
            self.assertEqual(result['detail'], 'PDF sent on WhatsApp to +919825012345.')
            (args,) = runs
            self.assertEqual(args[args.index('-Phone') + 1], '919825012345')
            pdf = Path(args[args.index('-Pdf') + 1])
            self.assertTrue(pdf.read_bytes().startswith(b'%PDF'))
            # WhatsApp not coming to the front: a clear message, nothing claimed as sent
            with mock.patch('core.whatsapp_desktop.subprocess.run',
                            lambda *a, **k: SimpleNamespace(returncode=2, stdout='', stderr='')):
                r = self.client.post(f'/api/sales/{sale["id"]}/whatsapp/', {}, format='json')
            self.assertEqual(r.status_code, 400)
            self.assertIn('WhatsApp Desktop did not open', r.data['detail'])

    @override_settings(WHATSAPP_LOCAL_URL='http://127.0.0.1:9')  # no WhatsApp service running
    def test_whatsapp_not_set_up(self):
        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {'party': customer['id'],
                                         'items': [{'item': item['id'], 'quantity': '1', 'rate': '500'}]})
        self.assertFalse(self.get(f'/api/sales/{sale["id"]}/share/')['whatsapp_api'])
        r = self.client.post(f'/api/sales/{sale["id"]}/whatsapp/', {}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('WhatsApp service is not running', r.data['detail'])
        self.assertEqual(self.get('/api/whatsapp/status/')['status'], 'not_running')

    def test_whatsapp_sends_pdf_from_linked_whatsapp(self):
        import base64
        import json
        from unittest import mock

        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {'party': customer['id'],
                                         'items': [{'item': item['id'], 'quantity': '2', 'rate': '500'}]})
        sent = []

        class Reply:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return json.dumps(self.body).encode()

        linked = [
            {'id': 'main', 'status': 'connected', 'phone': '919999900000', 'qr': None, 'code': None},
            {'id': '919888800000', 'status': 'connected', 'phone': '919888800000', 'qr': None, 'code': None},
        ]

        def fake_urlopen(request, timeout=None):
            if request.full_url.endswith('/status'):
                return Reply({'status': 'connected', 'qr': None, 'phone': '919999900000', 'accounts': linked})
            sent.append(json.loads(request.data))
            return Reply({'ok': True, 'number': '919825012345'})

        with mock.patch('core.whatsapp.urlopen', fake_urlopen):
            self.assertTrue(self.get(f'/api/sales/{sale["id"]}/share/')['whatsapp_api'])
            status = self.get('/api/whatsapp/status/')
            self.assertEqual(status['phone'], '919999900000')
            self.assertEqual([a['phone'] for a in status['accounts']], ['919999900000', '919888800000'])
            result = self.post(f'/api/sales/{sale["id"]}/whatsapp/', {}, status=200)
            # a phone that linked its own number sends from it
            self.post(f'/api/sales/{sale["id"]}/whatsapp/', {'account': '919888800000'}, status=200)
        self.assertEqual(result['detail'], 'PDF sent on WhatsApp to +919825012345.')
        message, from_phone = sent
        self.assertEqual(message['account'], '')  # no number chosen on the device: the main one
        self.assertEqual(from_phone['account'], '919888800000')
        self.assertEqual(message['phone'], '919825012345')  # the number on the bill, no contact to choose
        self.assertTrue(message['filename'].endswith('.pdf'))
        self.assertIn('₹1,000.00', message['caption'])
        self.assertTrue(base64.b64decode(message['pdf_base64']).startswith(b'%PDF'))
        # first-page preview shown above the file in WhatsApp, with the page count
        self.assertTrue(base64.b64decode(message['thumbnail_base64']).startswith(bytes([0xFF, 0xD8])))  # JPEG
        self.assertEqual((message['thumbnail_width'], message['page_count']), (480, 1))

    def test_whatsapp_link_by_code(self):
        import json
        from unittest import mock

        calls = []

        class Reply:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return json.dumps(self.body).encode()

        def fake_urlopen(request, timeout=None):
            calls.append((request.full_url, json.loads(request.data) if request.data else None))
            return Reply({'ok': True, 'id': '919876543210'})

        with mock.patch('core.whatsapp.urlopen', fake_urlopen):
            result = self.post('/api/whatsapp/link/', {'phone': '98765 43210'}, status=200)
            r = self.client.post('/api/whatsapp/link/', {'phone': '123'}, format='json')
        self.assertEqual(result['id'], '919876543210')
        self.assertEqual([(url.rsplit('/', 1)[-1], body) for url, body in calls], [('link', {'phone': '919876543210'})])  # with the country code
        self.assertEqual(r.status_code, 400)
        self.assertIn('phone', r.data['errors'])

    def test_share_link_and_search(self):
        customer, bank, item = self.setup_masters()
        sale = self.post('/api/sales/', {'party': customer['id'], 'total': '999'})
        share = self.get(f'/api/sales/{sale["id"]}/share/')
        self.assertIn('wa.me/919825012345', share['whatsapp_url'])
        public = APIClient().get(f'/api/public/documents/{share["token"]}/')
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.data['document']['total'], '₹999.00')
        self.assertIsNone(public.data['document']['business']['logo_url'])
        tampered = share['token'][:-2] + ('AA' if not share['token'].endswith('AA') else 'BB')
        self.assertEqual(APIClient().get(f'/api/public/documents/{tampered}/').status_code, 404)
        self.post('/api/business/reset-share-links/', {}, status=200)
        self.assertEqual(APIClient().get(f'/api/public/documents/{share["token"]}/').status_code, 404)
        results = self.get('/api/search/', q='Bil.1')['results']
        self.assertTrue(any(r['type'] == 'sale' for r in results))
        results = self.get('/api/search/', q='98250')['results']
        self.assertTrue(any(r['type'] == 'party' for r in results))
        parties = self.get('/api/parties/', search='Bil.1')['results']
        self.assertEqual(parties[0]['name'], 'Ghanshyambhai Nana')

    def test_day_book_counts_money_that_moved(self):
        customer, bank, item = self.setup_masters()
        credit = self.post('/api/sales/', {'party': customer['id'], 'total': '9433'})
        cash = self.post('/api/sales/', {'party': customer['id'], 'total': '1990', 'received_amount': '1990'})
        pay_in = self.post('/api/payments-in/', {'party': customer['id'], 'amount': '500',
                                                 'allocations': [{'bill': credit['id'], 'amount': '500'}]})
        supplier = self.post('/api/parties/', {'name': 'Solar Distributors', 'party_type': 'supplier'})
        purchase = self.post('/api/purchases/', {'party': supplier['id'], 'total': '3000', 'received_amount': '1000'})
        pay_out = self.post('/api/payments-out/', {'party': supplier['id'], 'amount': '700'})
        self.post('/api/bank-adjustments/', {'txn_type': 'deposit', 'amount': '400', 'from_account': self.cash['id'],
                                             'to_account': bank['id']})
        yesterday = (today() - timedelta(days=1)).isoformat()
        self.post('/api/sales/', {'party': customer['id'], 'total': '50', 'date': yesterday})

        report = self.get('/api/reports/day_book/')
        self.assertEqual(self.get('/api/reports/')['results'][0]['key'], 'day_book')
        rows = {(r['type'], r['number']): (r['total'], r['money_in'], r['money_out']) for r in report['rows']}
        self.assertEqual(rows, {
            ('Sale', credit['number']): ('9433.00', '0.00', '0.00'),
            ('Sale', cash['number']): ('1990.00', '1990.00', '0.00'),
            ('Payment In', pay_in['number']): ('500.00', '500.00', '0.00'),
            ('Purchase', purchase['number']): ('3000.00', '0.00', '1000.00'),
            ('Payment Out', pay_out['number']): ('700.00', '0.00', '700.00'),
        })
        self.assertEqual(report['rows'][0]['number'], pay_out['number'])  # newest first
        summary = {s['label']: (s['value'], s.get('tone')) for s in report['summary']}
        self.assertEqual(summary, {'Total': ('790.00', None), 'Money In': ('2490.00', 'pos'),
                                   'Money Out': ('1700.00', 'neg')})
        self.assertEqual(self.get('/api/reports/day_book/', date=yesterday)['row_count'], 1)
        for fmt in ('pdf', 'xlsx'):
            r = self.client.get(f'/api/reports/day_book/{fmt}/')
            self.assertEqual(r.status_code, 200, fmt)

    def test_every_report_builds(self):
        customer, bank, item = self.setup_masters()
        self.post('/api/sales/', {'party': customer['id'], 'items': [{'item': item['id'], 'quantity': '1',
                                                                       'rate': '500'}]})
        for definition in self.get('/api/reports/')['results']:
            data = self.get(f'/api/reports/{definition["key"]}/')
            self.assertIn('columns', data)
        self.get('/api/reports/customer_statement/', party=customer['id'])
        self.get('/api/reports/bank/', account=bank['id'])
        self.get('/api/reports/receivables/', view='bill')
        self.get('/api/reports/monthly_sales/', group='day')
        chart = self.get('/api/dashboard/chart/', period='this_week')
        self.assertEqual(chart['granularity'], 'day')
