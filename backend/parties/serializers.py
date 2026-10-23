from django.db.models.functions import Lower
from rest_framework import serializers

from core.fields import MoneyField, ScopedPK
from core.money import ZERO
from core.validators import clean_gstin, clean_phone, clean_pincode, clean_text

from .models import Party, Reminder

READ_MONEY = dict(max_digits=14, decimal_places=2, read_only=True)


class PartySerializer(serializers.ModelSerializer):
    opening_balance = MoneyField(required=False, min_value=0)
    receivable = serializers.DecimalField(**READ_MONEY)
    payable = serializers.DecimalField(**READ_MONEY)
    full_address = serializers.CharField(read_only=True)

    class Meta:
        model = Party
        fields = [
            'id', 'name', 'party_type', 'phone', 'phone_alt', 'email', 'address', 'city', 'state', 'pincode',
            'gstin', 'notes', 'opening_balance', 'opening_balance_type', 'opening_balance_date', 'is_active',
            'balance', 'receivable', 'payable', 'last_txn_date', 'full_address', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'balance', 'last_txn_date', 'created_at', 'updated_at']
        extra_kwargs = {
            'name': {'error_messages': {'blank': 'Party name is required.', 'required': 'Party name is required.'}},
        }

    def validate_name(self, value):
        value = clean_text(value, 150)
        if not value:
            raise serializers.ValidationError('Party name is required.')
        business = self.context['business']
        qs = Party.objects.filter(business=business).annotate(_n=Lower('name')).filter(_n=value.lower())
        if self.instance:
            qs = qs.exclude(id=self.instance.id)
        if qs.exists():
            raise serializers.ValidationError(f'A party named "{value}" already exists.')
        return value

    def validate_phone(self, value):
        return clean_phone(value)

    def validate_phone_alt(self, value):
        return clean_phone(value, 'Alternate mobile number')

    def validate_gstin(self, value):
        return clean_gstin(value)

    def validate_pincode(self, value):
        return clean_pincode(value)

    def validate_email(self, value):
        return (value or '').strip().lower()

    def validate(self, attrs):
        for field in ('address', 'city', 'state', 'notes'):
            if field in attrs:
                attrs[field] = (attrs[field] or '').strip()
        if attrs.get('opening_balance') is None and 'opening_balance' in attrs:
            attrs['opening_balance'] = ZERO
        return attrs


class PartyListSerializer(serializers.ModelSerializer):
    receivable = serializers.DecimalField(**READ_MONEY)
    payable = serializers.DecimalField(**READ_MONEY)

    class Meta:
        model = Party
        fields = ['id', 'name', 'party_type', 'phone', 'city', 'gstin', 'balance', 'receivable', 'payable',
                  'last_txn_date', 'is_active']


class ReminderSerializer(serializers.ModelSerializer):
    party = ScopedPK(Party)
    amount = MoneyField(min_value=0)
    party_name = serializers.CharField(source='party.name', read_only=True)
    party_phone = serializers.CharField(source='party.phone', read_only=True)
    party_balance = serializers.DecimalField(source='party.balance', **READ_MONEY)
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = Reminder
        fields = ['id', 'party', 'party_name', 'party_phone', 'party_balance', 'amount', 'due_date', 'message',
                  'status', 'last_sent_at', 'sent_count', 'is_overdue', 'created_at', 'updated_at']
        read_only_fields = ['id', 'last_sent_at', 'sent_count', 'created_at', 'updated_at']

    def get_is_overdue(self, obj):
        from core.dates import today
        return obj.status == Reminder.STATUS_PENDING and obj.due_date < today()

    def validate_message(self, value):
        return clean_text(value, 2000)
