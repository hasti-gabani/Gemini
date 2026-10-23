from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model, password_validation
from django.db.models.functions import Lower
from rest_framework import serializers

from core.files import validate_upload
from core.validators import clean_gstin, clean_phone, clean_pincode, clean_text

from .models import Business, BusinessSettings

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='display_name', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'name', 'first_name', 'last_name', 'email', 'phone', 'role']
        read_only_fields = ['id', 'username', 'role']

    def validate_phone(self, value):
        value = clean_phone(value)
        if value and User.objects.filter(phone=value).exclude(id=self.instance.id).exists():
            raise serializers.ValidationError('This mobile number is used by another account.')
        return value

    def validate_email(self, value):
        value = (value or '').strip().lower()
        if value and User.objects.filter(email__iexact=value).exclude(id=self.instance.id).exists():
            raise serializers.ValidationError('This email is used by another account.')
        return value


class RegisterSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    business_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=20)
    password = serializers.CharField(write_only=True, min_length=6, max_length=128)

    def validate_name(self, value):
        value = clean_text(value, 150)
        if not value:
            raise serializers.ValidationError('Please enter your name.')
        return value

    def validate_business_name(self, value):
        value = clean_text(value, 150)
        if not value:
            raise serializers.ValidationError('Please enter your business name.')
        return value

    def validate_email(self, value):
        value = (value or '').strip().lower()
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists. Please sign in.')
        return value

    def validate_phone(self, value):
        value = clean_phone(value)
        if value and User.objects.filter(phone=value).exists():
            raise serializers.ValidationError('An account with this mobile number already exists. Please sign in.')
        return value

    def validate(self, attrs):
        if not attrs.get('email') and not attrs.get('phone'):
            raise serializers.ValidationError({'phone': 'Enter a mobile number or email to sign in with.'})
        username = attrs.get('email') or attrs.get('phone')
        if User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError({'email': 'An account with these details already exists.'})
        candidate = User(username=username, email=attrs.get('email', ''), first_name=attrs['name'])
        try:
            password_validation.validate_password(attrs['password'], candidate)
        except Exception as exc:  # django ValidationError
            raise serializers.ValidationError({'password': list(getattr(exc, 'messages', [str(exc)]))})
        attrs['username'] = username
        return attrs


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, write_only=True)
    remember = serializers.BooleanField(default=True)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(max_length=128)
    new_password = serializers.CharField(min_length=6, max_length=128)

    def validate(self, attrs):
        user = self.context['request'].user
        if not user.check_password(attrs['current_password']):
            raise serializers.ValidationError({'current_password': 'Current password is incorrect.'})
        try:
            password_validation.validate_password(attrs['new_password'], user)
        except Exception as exc:
            raise serializers.ValidationError({'new_password': list(getattr(exc, 'messages', [str(exc)]))})
        return attrs


class BusinessSerializer(serializers.ModelSerializer):
    logo = serializers.ImageField(write_only=True, required=False, allow_null=True)
    remove_logo = serializers.BooleanField(write_only=True, required=False, default=False)
    logo_url = serializers.SerializerMethodField()
    full_address = serializers.CharField(read_only=True)

    class Meta:
        model = Business
        fields = ['id', 'name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'gstin',
                  'full_address', 'logo', 'remove_logo', 'logo_url', 'updated_at']
        read_only_fields = ['id', 'updated_at']

    def get_logo_url(self, obj):
        if not obj.logo:
            return None
        return f'/api/business/logo/?v={int(obj.updated_at.timestamp())}'

    def validate_name(self, value):
        value = clean_text(value, 150)
        if not value:
            raise serializers.ValidationError('Business name is required.')
        return value

    def validate_phone(self, value):
        return clean_phone(value)

    def validate_gstin(self, value):
        return clean_gstin(value)

    def validate_pincode(self, value):
        return clean_pincode(value)

    def validate_logo(self, value):
        if value:
            validate_upload(value, allow_pdf=False, max_mb=5)
        return value

    def update(self, instance, validated_data):
        remove = validated_data.pop('remove_logo', False)
        logo = validated_data.pop('logo', None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if logo:
            from core.files import optimize_image
            content, _ctype, ext = optimize_image(logo, max_px=800)
            instance.logo.save(f'logo{ext}', content, save=False)
        elif remove:
            instance.logo = None
        instance.save()
        return instance


def _clean_rate_list(values):
    cleaned = set()
    for value in values or []:
        try:
            rate = Decimal(str(value)).quantize(Decimal('0.01'))
        except (InvalidOperation, ValueError):
            raise serializers.ValidationError(f'"{value}" is not a valid tax rate.')
        if rate < 0 or rate > 100:
            raise serializers.ValidationError('Tax rates must be between 0 and 100.')
        cleaned.add(rate.normalize())
    ordered = sorted(cleaned)
    return [format(r, 'f') for r in ordered] or ['0']


class SettingsSerializer(serializers.ModelSerializer):
    sale_prefix = serializers.CharField(max_length=20, allow_blank=True, trim_whitespace=False, required=False)
    purchase_prefix = serializers.CharField(max_length=20, allow_blank=True, trim_whitespace=False, required=False)
    payment_in_prefix = serializers.CharField(max_length=20, allow_blank=True, trim_whitespace=False, required=False)
    payment_out_prefix = serializers.CharField(max_length=20, allow_blank=True, trim_whitespace=False, required=False)

    class Meta:
        model = BusinessSettings
        exclude = ['id', 'business', 'delete_pin']
        read_only_fields = ['updated_at', 'backup_copy_folder', 'backup_copy_status', 'backup_copy_message',
                            'backup_copy_checked_at']

    def validate_units(self, value):
        seen = []
        for unit in value or []:
            unit = str(unit).strip().upper()[:20]
            if unit and unit not in seen:
                seen.append(unit)
        if not seen:
            raise serializers.ValidationError('Keep at least one unit.')
        return seen

    def validate_tax_rates(self, value):
        return _clean_rate_list(value)

    def _prefix(self, value):
        value = value or ''
        if len(value) > 20:
            raise serializers.ValidationError('Prefix can be at most 20 characters.')
        if any(ch.isdigit() for ch in value[-1:]):
            raise serializers.ValidationError('Prefix should not end with a digit (e.g. use "Bil." or "INV-").')
        return value

    validate_sale_prefix = _prefix
    validate_purchase_prefix = _prefix
    validate_payment_in_prefix = _prefix
    validate_payment_out_prefix = _prefix

    def validate(self, attrs):
        for field in ('sale_start_number', 'purchase_start_number', 'payment_in_start_number',
                      'payment_out_start_number'):
            if field in attrs and attrs[field] < 1:
                raise serializers.ValidationError({field: 'Starting number must be at least 1.'})
        return attrs


def unique_ci(model, business, field, value, exclude_id=None):
    qs = model.objects.filter(business=business).annotate(_v=Lower(field)).filter(_v=value.lower())
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return not qs.exists()
