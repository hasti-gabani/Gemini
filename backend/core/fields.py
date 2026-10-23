from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from rest_framework import serializers


class ScopedPK(serializers.PrimaryKeyRelatedField):
    """Primary key field limited to the requesting user's business."""

    default_error_messages = {
        'does_not_exist': 'The selected record was not found. It may have been deleted.',
        'incorrect_type': 'Invalid selection.',
        'required': 'This field is required.',
    }

    def __init__(self, model, **kwargs):
        self.model = model
        self.extra_filter = kwargs.pop('extra_filter', None)
        kwargs.setdefault('queryset', model.objects.none())
        super().__init__(**kwargs)

    def get_queryset(self):
        request = self.context.get('request')
        business = self.context.get('business') or getattr(getattr(request, 'user', None), 'business', None)
        if business is None:
            return self.model.objects.none()
        qs = self.model.objects.filter(business=business)
        if self.extra_filter:
            qs = qs.filter(**self.extra_filter)
        return qs


class _RoundingDecimalField(serializers.DecimalField):
    """Accepts '1,234.567' style input and rounds HALF_UP instead of rejecting extra decimals."""

    places = 2

    def __init__(self, **kwargs):
        kwargs.setdefault('max_digits', 14)
        kwargs.setdefault('decimal_places', self.places)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        if isinstance(data, str):
            data = data.replace(',', '').strip() or '0'
        try:
            data = Decimal(str(data)).quantize(Decimal(1).scaleb(-self.decimal_places), rounding=ROUND_HALF_UP)
        except (InvalidOperation, ValueError, TypeError):
            pass
        return super().to_internal_value(data)


class MoneyField(_RoundingDecimalField):
    places = 2
    default_error_messages = {
        'invalid': 'Enter a valid amount.',
        'max_digits': 'Amount is too large.',
        'max_whole_digits': 'Amount is too large.',
        'min_value': 'Amount cannot be less than {min_value}.',
    }


class QtyField(_RoundingDecimalField):
    places = 3
    default_error_messages = {
        'invalid': 'Enter a valid quantity.',
        'max_digits': 'Quantity is too large.',
        'max_whole_digits': 'Quantity is too large.',
    }


class PercentField(_RoundingDecimalField):
    places = 2

    def __init__(self, **kwargs):
        kwargs.setdefault('max_digits', 5)
        kwargs.setdefault('min_value', 0)
        kwargs.setdefault('max_value', 100)
        super().__init__(**kwargs)

    default_error_messages = {
        'invalid': 'Enter a valid percentage.',
        'min_value': 'Percentage cannot be negative.',
        'max_value': 'Percentage cannot be more than 100.',
    }
