import re
from decimal import Decimal

from rest_framework import serializers

from core.fields import MoneyField, ScopedPK
from core.validators import clean_ifsc, clean_text

from .models import BankAccount, BankAdjustment
from .services import BANK_NAME

UPI_RE = re.compile(r'^[\w.\-]{2,}@[a-zA-Z][a-zA-Z0-9]{1,}$')


class BankAccountSerializer(serializers.ModelSerializer):
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    opening_balance = MoneyField(required=False)
    masked_number = serializers.CharField(read_only=True)

    class Meta:
        model = BankAccount
        fields = [
            'id', 'kind', 'name', 'bank_name', 'account_name', 'account_number', 'masked_number', 'ifsc', 'branch',
            'upi_id', 'opening_balance', 'opening_date', 'notes', 'is_default', 'print_on_invoice', 'is_active',
            'current_balance', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'kind', 'current_balance', 'created_at', 'updated_at']

    CASH_EDITABLE = {'name', 'opening_balance', 'opening_date', 'notes'}

    def validate_account_number(self, value):
        value = re.sub(r'\s+', '', value or '')
        if value and not re.fullmatch(r'[A-Za-z0-9]{4,30}', value):
            raise serializers.ValidationError('Enter a valid account number (letters and digits only).')
        return value.upper()

    def validate_ifsc(self, value):
        return clean_ifsc(value)

    def validate_upi_id(self, value):
        value = (value or '').strip()
        if value and not UPI_RE.match(value):
            raise serializers.ValidationError('Enter a valid UPI ID (e.g. business@okhdfcbank).')
        return value

    def validate(self, attrs):
        instance = self.instance
        is_cash = instance is not None and instance.kind == BankAccount.KIND_CASH
        if is_cash:
            attrs = {key: value for key, value in attrs.items() if key in self.CASH_EDITABLE}
            if 'name' in attrs:
                attrs['name'] = clean_text(attrs['name'], 120) or 'Cash in Hand'
            return attrs
        for field in ('bank_name', 'account_name', 'branch', 'notes'):
            if field in attrs:
                attrs[field] = clean_text(attrs[field], 2000 if field == 'notes' else 120)
        if not attrs.get('bank_name', instance.bank_name if instance else ''):
            attrs['bank_name'] = BANK_NAME
        number = attrs.get('account_number', instance.account_number if instance else '')
        attrs['name'] = BANK_NAME  # the one bank account is always shown as B
        if number:
            qs = BankAccount.objects.filter(business=self.context['business'], account_number__iexact=number,
                                            kind=BankAccount.KIND_BANK)
            if instance:
                qs = qs.exclude(id=instance.id)
            if qs.exists():
                raise serializers.ValidationError({'account_number': 'This account number is already added.'})
        return attrs


class BankAdjustmentSerializer(serializers.ModelSerializer):
    amount = MoneyField(min_value=Decimal('0.01'))
    from_account = ScopedPK(BankAccount, required=False, allow_null=True)
    to_account = ScopedPK(BankAccount, required=False, allow_null=True)
    from_account_name = serializers.CharField(source='from_account.name', read_only=True, default='')
    to_account_name = serializers.CharField(source='to_account.name', read_only=True, default='')
    txn_type_label = serializers.CharField(source='get_txn_type_display', read_only=True)

    class Meta:
        model = BankAdjustment
        fields = ['id', 'txn_type', 'txn_type_label', 'date', 'amount', 'from_account', 'from_account_name',
                  'to_account', 'to_account_name', 'description', 'reference_no', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
        extra_kwargs = {'amount': {'error_messages': {'min_value': 'Enter an amount greater than zero.'}}}

    def validate(self, attrs):
        from .services import validate_adjustment_accounts

        instance = self.instance
        txn_type = attrs.get('txn_type', instance.txn_type if instance else None)
        from_account = attrs.get('from_account', instance.from_account if instance else None)
        to_account = attrs.get('to_account', instance.to_account if instance else None)
        validate_adjustment_accounts(txn_type, from_account, to_account)
        attrs['description'] = clean_text(attrs.get('description', instance.description if instance else ''), 255)
        attrs['reference_no'] = clean_text(attrs.get('reference_no', instance.reference_no if instance else ''), 80)
        return attrs
