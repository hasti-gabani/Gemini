from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone


class Category(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE, related_name='categories')
    name = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'categories'
        constraints = [
            models.UniqueConstraint(Lower('name'), 'business', name='unique_category_name_per_business'),
        ]

    def __str__(self):
        return self.name


class Item(models.Model):
    """Product or service. Stock figures are cached and always recomputed from
    opening stock + purchases - sales + manual adjustments."""

    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE, related_name='items')
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True, related_name='items')
    unit = models.CharField(max_length=20, default='PCS')
    hsn = models.CharField(max_length=20, blank=True)
    sale_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    purchase_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    tax_inclusive = models.BooleanField(default=False)
    track_stock = models.BooleanField(default=True)
    opening_stock = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    low_stock_limit = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to='items/', blank=True, null=True)
    is_active = models.BooleanField(default=True)
    current_stock = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    sold_qty = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    purchased_qty = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(Lower('name'), 'business', name='unique_item_name_per_business'),
            models.UniqueConstraint(fields=['business', 'code'], condition=~Q(code=''),
                                    name='unique_item_code_per_business'),
        ]
        indexes = [
            models.Index(fields=['business', 'name']),
            models.Index(fields=['business', 'code']),
        ]

    def __str__(self):
        return self.name

    @property
    def is_low_stock(self):
        return bool(self.track_stock and self.low_stock_limit and self.current_stock <= self.low_stock_limit)


class StockAdjustment(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.CASCADE, related_name='stock_adjustments')
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='adjustments')
    date = models.DateField(default=timezone.localdate)
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-id']

    def __str__(self):
        return f'{self.item} {self.quantity:+}'
