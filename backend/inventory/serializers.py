from django.db.models.functions import Lower
from rest_framework import serializers

from core.fields import MoneyField, PercentField, QtyField, ScopedPK
from core.files import validate_upload
from core.validators import clean_text

from .models import Category, Item, StockAdjustment


class CategorySerializer(serializers.ModelSerializer):
    item_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Category
        fields = ['id', 'name', 'item_count', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate_name(self, value):
        value = clean_text(value, 80)
        if not value:
            raise serializers.ValidationError('Category name is required.')
        qs = Category.objects.filter(business=self.context['business']).annotate(_n=Lower('name')).filter(
            _n=value.lower())
        if self.instance:
            qs = qs.exclude(id=self.instance.id)
        if qs.exists():
            raise serializers.ValidationError(f'Category "{value}" already exists.')
        return value


class ItemSerializer(serializers.ModelSerializer):
    category = ScopedPK(Category, required=False, allow_null=True)
    category_name = serializers.CharField(source='category.name', read_only=True, default='')
    sale_price = MoneyField(required=False, min_value=0)
    purchase_price = MoneyField(required=False, min_value=0)
    tax_rate = PercentField(required=False)
    opening_stock = QtyField(required=False, min_value=0)
    low_stock_limit = QtyField(required=False, min_value=0)
    image = serializers.ImageField(write_only=True, required=False, allow_null=True)
    remove_image = serializers.BooleanField(write_only=True, required=False, default=False)
    image_url = serializers.SerializerMethodField()
    is_low_stock = serializers.BooleanField(read_only=True)
    stock_value = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = [
            'id', 'name', 'code', 'category', 'category_name', 'unit', 'hsn', 'sale_price', 'purchase_price',
            'tax_rate', 'tax_inclusive', 'track_stock', 'opening_stock', 'low_stock_limit', 'description',
            'image', 'remove_image', 'image_url', 'is_active', 'current_stock', 'sold_qty', 'purchased_qty',
            'is_low_stock', 'stock_value', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'current_stock', 'sold_qty', 'purchased_qty', 'created_at', 'updated_at']

    def get_image_url(self, obj):
        if not obj.image:
            return None
        return f'/api/items/{obj.id}/image/?v={int(obj.updated_at.timestamp())}'

    def get_stock_value(self, obj):
        from core.money import q2
        return str(q2(max(obj.current_stock, 0) * obj.purchase_price)) if obj.track_stock else '0.00'

    def validate_name(self, value):
        value = clean_text(value, 200)
        if not value:
            raise serializers.ValidationError('Item name is required.')
        qs = Item.objects.filter(business=self.context['business']).annotate(_n=Lower('name')).filter(
            _n=value.lower())
        if self.instance:
            qs = qs.exclude(id=self.instance.id)
        if qs.exists():
            raise serializers.ValidationError(f'An item named "{value}" already exists.')
        return value

    def validate_code(self, value):
        value = clean_text(value, 50)
        if value:
            qs = Item.objects.filter(business=self.context['business'], code__iexact=value)
            if self.instance:
                qs = qs.exclude(id=self.instance.id)
            if qs.exists():
                raise serializers.ValidationError(f'Item code "{value}" is already used.')
        return value

    def validate_unit(self, value):
        return clean_text(value, 20).upper() or 'PCS'

    def validate_hsn(self, value):
        return clean_text(value, 20)

    def validate_image(self, value):
        if value:
            validate_upload(value, allow_pdf=False, max_mb=8)
        return value

    def validate_description(self, value):
        return clean_text(value, 2000)


class ItemLookupSerializer(serializers.ModelSerializer):
    """Compact item for pickers in bill forms."""

    class Meta:
        model = Item
        fields = ['id', 'name', 'code', 'unit', 'hsn', 'sale_price', 'purchase_price', 'tax_rate', 'tax_inclusive',
                  'track_stock', 'current_stock', 'low_stock_limit', 'is_active']


class StockAdjustmentSerializer(serializers.ModelSerializer):
    quantity = QtyField()

    class Meta:
        model = StockAdjustment
        fields = ['id', 'item', 'date', 'quantity', 'note', 'created_at']
        read_only_fields = ['id', 'item', 'created_at']

    def validate_quantity(self, value):
        if value == 0:
            raise serializers.ValidationError('Enter a quantity to add (+) or reduce (-).')
        return value

    def validate_note(self, value):
        return clean_text(value, 255)
