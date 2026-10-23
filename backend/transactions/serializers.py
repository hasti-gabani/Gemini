from rest_framework import serializers

from banking.models import BankAccount
from core.fields import MoneyField, PercentField, QtyField, ScopedPK
from core.money import ZERO
from core.validators import clean_gstin, clean_phone, clean_text
from inventory.models import Item
from parties.models import Party

from .models import Attachment, PaymentIn, PaymentOut, Purchase, PurchaseItem, Sale, SaleItem

READ_MONEY = dict(max_digits=14, decimal_places=2, read_only=True)


def bill_kind(context):
    return context.get('kind', 'sale')


# --------------------------------------------------------------------------- attachments

class AttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = ['id', 'original_name', 'content_type', 'kind', 'size', 'url', 'created_at']

    def get_url(self, obj):
        return f'/api/attachments/{obj.id}/file/'


# --------------------------------------------------------------------------- bills (write)

class BillLineInputSerializer(serializers.Serializer):
    item = ScopedPK(Item, required=False, allow_null=True)
    name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    code = serializers.CharField(max_length=50, required=False, allow_blank=True)
    unit = serializers.CharField(max_length=20, required=False, allow_blank=True)
    hsn = serializers.CharField(max_length=20, required=False, allow_blank=True)
    quantity = QtyField(error_messages={'required': 'Quantity is required.', 'invalid': 'Enter a valid quantity.'})
    rate = MoneyField(min_value=0, error_messages={'required': 'Rate is required.',
                                                   'min_value': 'Rate cannot be negative.'})
    discount_percent = PercentField(required=False, default=0)
    discount_amount = MoneyField(required=False, default=0, min_value=0)
    tax_rate = PercentField(required=False, default=0)
    tax_inclusive = serializers.BooleanField(required=False, default=False)

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError('Quantity must be greater than 0.')
        return value

    def validate(self, attrs):
        if not (attrs.get('name') or '').strip() and not attrs.get('item'):
            raise serializers.ValidationError({'name': 'Item name is required.'})
        return attrs


class BillWriteSerializer(serializers.Serializer):
    number = serializers.CharField(max_length=40, required=False, allow_blank=True)
    date = serializers.DateField(required=False)
    due_date = serializers.DateField(required=False, allow_null=True)
    # Optional: the mode is worked out from the received amount. 'cash' = received in full.
    mode = serializers.ChoiceField(choices=Sale.MODE_CHOICES, required=False)
    party = ScopedPK(Party, required=False, allow_null=True)
    party_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    party_phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    party_address = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    party_gstin = serializers.CharField(max_length=15, required=False, allow_blank=True)
    items = BillLineInputSerializer(many=True, required=False)
    discount_percent = PercentField(required=False, default=0)
    discount_amount = MoneyField(required=False, default=0, min_value=0)
    charges_label = serializers.CharField(max_length=60, required=False, allow_blank=True)
    charges_amount = MoneyField(required=False, default=0, min_value=0)
    auto_round_off = serializers.BooleanField(required=False, default=True)
    round_off = MoneyField(required=False, default=0)
    total = MoneyField(required=False, allow_null=True, min_value=0)
    received_amount = MoneyField(required=False, default=0, min_value=0,
                                 error_messages={'min_value': 'Amount cannot be negative.'})
    payment_account = ScopedPK(BankAccount, required=False, allow_null=True)
    payment_reference = serializers.CharField(max_length=80, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    terms = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    attachment_ids = serializers.ListField(child=serializers.IntegerField(), required=False, max_length=10)

    def validate_party_phone(self, value):
        return clean_phone(value)

    def validate_party_gstin(self, value):
        return clean_gstin(value)

    def validate_party_name(self, value):
        return clean_text(value, 150)

    def validate_items(self, value):
        if len(value) > 500:
            raise serializers.ValidationError('A bill can have at most 500 items.')
        return value


# --------------------------------------------------------------------------- bills (read)

class BillLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleItem
        fields = ['id', 'item', 'name', 'code', 'unit', 'hsn', 'quantity', 'rate', 'discount_percent',
                  'discount_amount', 'tax_rate', 'tax_inclusive', 'gross', 'taxable_amount', 'tax_amount', 'amount',
                  'position']


class PurchaseLineSerializer(BillLineSerializer):
    class Meta(BillLineSerializer.Meta):
        model = PurchaseItem


def _party_brief(party):
    if party is None:
        return None
    return {'id': party.id, 'name': party.name, 'phone': party.phone, 'address': party.full_address,
            'gstin': party.gstin, 'balance': str(party.balance), 'party_type': party.party_type}


class BillDetailSerializer(serializers.ModelSerializer):
    kind = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    payments = serializers.SerializerMethodField()
    attachments = AttachmentSerializer(many=True, read_only=True)
    party_detail = serializers.SerializerMethodField()
    origin_payment = serializers.SerializerMethodField()
    is_overdue = serializers.BooleanField(read_only=True)
    payment_status_label = serializers.CharField(source='get_payment_status_display', read_only=True)

    class Meta:
        model = Sale
        fields = [
            'id', 'kind', 'number', 'prefix', 'seq', 'date', 'due_date', 'mode', 'party', 'party_detail',
            'party_name', 'party_phone', 'party_address', 'party_gstin', 'items', 'subtotal', 'item_discount',
            'tax_total', 'items_total', 'discount_percent', 'discount_amount', 'charges_label', 'charges_amount',
            'auto_round_off', 'round_off', 'total', 'manual_total', 'paid_amount', 'balance_due', 'payment_status',
            'payment_status_label', 'is_overdue', 'notes', 'terms', 'payments', 'origin_payment', 'attachments',
            'created_at', 'updated_at',
        ]

    def get_kind(self, obj):
        return 'sale' if isinstance(obj, Sale) else 'purchase'

    def get_items(self, obj):
        serializer = BillLineSerializer if isinstance(obj, Sale) else PurchaseLineSerializer
        return serializer(obj.items.all(), many=True).data

    def get_party_detail(self, obj):
        return _party_brief(obj.party)

    def get_payments(self, obj):
        origin_ids = set(obj.origin_payments.values_list('id', flat=True))
        rows = []
        allocations = obj.allocations.select_related('payment__account').order_by('payment__date', 'payment_id')
        for allocation in allocations:
            payment = allocation.payment
            rows.append({
                'id': payment.id, 'number': payment.number, 'date': payment.date, 'amount': str(allocation.amount),
                'payment_amount': str(payment.amount), 'account': payment.account_id,
                'account_name': payment.account.name, 'account_kind': payment.account.kind,
                'reference_no': payment.reference_no, 'is_origin': payment.id in origin_ids,
            })
        return rows

    def get_origin_payment(self, obj):
        origin = obj.origin_payments.select_related('account').first()
        if origin is None:
            return None
        return {'id': origin.id, 'number': origin.number, 'amount': str(origin.amount), 'account': origin.account_id,
                'account_name': origin.account.name, 'account_kind': origin.account.kind,
                'reference_no': origin.reference_no}


class BillListSerializer(serializers.ModelSerializer):
    items_summary = serializers.SerializerMethodField()
    item_count = serializers.SerializerMethodField()
    total_qty = serializers.SerializerMethodField()
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = Sale
        fields = ['id', 'number', 'date', 'due_date', 'mode', 'party', 'party_name', 'party_phone', 'total',
                  'paid_amount', 'balance_due', 'payment_status', 'is_overdue', 'items_summary', 'item_count',
                  'total_qty', 'created_at']

    def _lines(self, obj):
        # items are prefetched by the view
        return list(obj.items.all())

    def get_items_summary(self, obj):
        lines = self._lines(obj)
        names = [line.name for line in lines[:3]]
        if len(lines) > 3:
            names.append(f'+{len(lines) - 3} more')
        return ', '.join(names)

    def get_item_count(self, obj):
        return len(self._lines(obj))

    def get_total_qty(self, obj):
        from core.money import fmt_qty
        return fmt_qty(sum((line.quantity for line in self._lines(obj)), ZERO))


# --------------------------------------------------------------------------- payments

class AllocationInputSerializer(serializers.Serializer):
    bill = serializers.IntegerField()
    amount = MoneyField(min_value=0)


class PaymentWriteSerializer(serializers.Serializer):
    number = serializers.CharField(max_length=40, required=False, allow_blank=True)
    date = serializers.DateField(required=False)
    party = ScopedPK(Party, required=False, allow_null=True)
    account = ScopedPK(BankAccount, required=False, allow_null=True)
    amount = MoneyField(error_messages={'required': 'Enter the payment amount.', 'invalid': 'Enter a valid amount.'})
    reference_no = serializers.CharField(max_length=80, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    allocations = AllocationInputSerializer(many=True, required=False, allow_null=True)
    auto_allocate = serializers.BooleanField(required=False, default=True)
    # Kept for older clients; advances are always allowed now.
    allow_advance = serializers.BooleanField(required=False, default=True)
    attachment_ids = serializers.ListField(child=serializers.IntegerField(), required=False, max_length=10)

    def validate_allocations(self, value):
        if value is None:
            return None
        model = Sale if self.context.get('kind') == 'in' else Purchase
        ids = [entry['bill'] for entry in value]
        bills = {bill.id: bill for bill in model.objects.filter(business=self.context['business'], id__in=ids)}
        result = []
        for entry in value:
            bill = bills.get(entry['bill'])
            if bill is None:
                raise serializers.ValidationError('One of the selected bills was not found. It may have been deleted.')
            result.append({'bill': bill, 'amount': entry['amount']})
        return result

    def validate_reference_no(self, value):
        return clean_text(value, 80)


class PaymentDetailSerializer(serializers.ModelSerializer):
    kind = serializers.SerializerMethodField()
    party_detail = serializers.SerializerMethodField()
    account_name = serializers.CharField(source='account.name', read_only=True)
    account_kind = serializers.CharField(source='account.kind', read_only=True)
    unallocated_amount = serializers.DecimalField(**READ_MONEY)
    allocations = serializers.SerializerMethodField()
    attachments = AttachmentSerializer(many=True, read_only=True)
    origin_bill = serializers.SerializerMethodField()

    class Meta:
        model = PaymentIn
        fields = ['id', 'kind', 'number', 'date', 'party', 'party_name', 'party_detail', 'account', 'account_name',
                  'account_kind', 'amount', 'reference_no', 'notes', 'allocated_amount', 'unallocated_amount',
                  'allocations', 'attachments', 'origin_bill', 'created_at', 'updated_at']

    def get_kind(self, obj):
        return 'in' if isinstance(obj, PaymentIn) else 'out'

    def get_party_detail(self, obj):
        return _party_brief(obj.party)

    def get_allocations(self, obj):
        bill_attr = 'sale' if isinstance(obj, PaymentIn) else 'purchase'
        rows = []
        for allocation in obj.allocations.select_related(bill_attr).order_by(f'{bill_attr}__date'):
            bill = getattr(allocation, bill_attr)
            rows.append({'bill': bill.id, 'number': bill.number, 'date': bill.date, 'total': str(bill.total),
                         'balance_due': str(bill.balance_due), 'payment_status': bill.payment_status,
                         'amount': str(allocation.amount)})
        return rows

    def get_origin_bill(self, obj):
        bill = obj.origin_sale if isinstance(obj, PaymentIn) else obj.origin_purchase
        if bill is None:
            return None
        return {'id': bill.id, 'number': bill.number, 'mode': bill.mode}


class PaymentListSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source='account.name', read_only=True)
    account_kind = serializers.CharField(source='account.kind', read_only=True)
    against = serializers.SerializerMethodField()
    attachment_count = serializers.SerializerMethodField()
    unallocated_amount = serializers.DecimalField(**READ_MONEY)

    class Meta:
        model = PaymentIn
        fields = ['id', 'number', 'date', 'party', 'party_name', 'account', 'account_name', 'account_kind', 'amount',
                  'reference_no', 'allocated_amount', 'unallocated_amount', 'against', 'attachment_count',
                  'created_at']

    def get_against(self, obj):
        bill_attr = 'sale' if isinstance(obj, PaymentIn) else 'purchase'
        return [getattr(a, bill_attr).number for a in obj.allocations.all()]

    def get_attachment_count(self, obj):
        return len(obj.attachments.all())
