from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Lower
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.dates import today
from core.files import optimize_image, stream_file
from core.mixins import BusinessScopedMixin, query_bool
from core.money import ZERO, money_str, q2, qty_str

from . import services
from .models import Category, Item, StockAdjustment
from .serializers import CategorySerializer, ItemLookupSerializer, ItemSerializer, StockAdjustmentSerializer


class CategoryViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    model = Category
    serializer_class = CategorySerializer
    pagination_class = None

    def scope_queryset(self, qs):
        return qs.annotate(item_count=Count('items')).order_by(Lower('name'))

    def perform_create(self, serializer):
        serializer.save(business=self.business)


def _apply_image(item, data):
    image = data.pop('image', None)
    remove = data.pop('remove_image', False)
    if image:
        content, _ctype, ext = optimize_image(image, max_px=1000)
        item.image.save(f'item{ext}', content, save=False)
    elif remove:
        item.image = None


class ItemViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    model = Item
    serializer_class = ItemSerializer

    ORDERINGS = {
        'name': [Lower('name')],
        '-current_stock': ['-current_stock', Lower('name')],
        'current_stock': ['current_stock', Lower('name')],
        '-sold_qty': ['-sold_qty', Lower('name')],
        '-created_at': ['-created_at'],
        '-sale_price': ['-sale_price', Lower('name')],
    }

    def get_serializer_class(self):
        if self.action == 'list' and self.request.query_params.get('view') == 'lookup':
            return ItemLookupSerializer
        return ItemSerializer

    def scope_queryset(self, qs):
        qs = qs.select_related('category')
        if self.action != 'list':
            return qs
        params = self.request.query_params
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(code__icontains=search) | Q(hsn__icontains=search))
        category = params.get('category')
        if category == 'none':
            qs = qs.filter(category__isnull=True)
        elif category:
            qs = qs.filter(category_id=category)
        stock = params.get('stock')
        if stock == 'low':
            qs = qs.filter(track_stock=True, low_stock_limit__gt=0, current_stock__lte=F('low_stock_limit'))
        elif stock == 'out':
            qs = qs.filter(track_stock=True, current_stock__lte=0)
        elif stock == 'in':
            qs = qs.filter(Q(track_stock=False) | Q(current_stock__gt=0))
        if not query_bool(self.request, 'include_inactive', default=True):
            qs = qs.filter(is_active=True)
        return qs.order_by(*self.ORDERINGS.get(params.get('ordering'), self.ORDERINGS['name']))

    def list(self, request, *args, **kwargs):
        if request.query_params.get('view') != 'lookup':
            items = Item.objects.filter(business=self.business)
            agg = items.aggregate(
                count=Count('id'),
                low=Count('id', filter=Q(track_stock=True, low_stock_limit__gt=0,
                                         current_stock__lte=F('low_stock_limit'))),
                out=Count('id', filter=Q(track_stock=True, current_stock__lte=0)),
            )
            value = ZERO
            for stock, price in items.filter(track_stock=True, current_stock__gt=0).values_list(
                    'current_stock', 'purchase_price'):
                value += stock * price
            self.list_summary = {
                'count': agg['count'], 'low_stock': agg['low'], 'out_of_stock': agg['out'],
                'stock_value': str(q2(value)),
            }
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        data = dict(serializer.validated_data)
        item = Item(business=self.business)
        _apply_image(item, data)
        for key, value in data.items():
            setattr(item, key, value)
        serializer.instance = services.save_item(item)

    def perform_update(self, serializer):
        data = dict(serializer.validated_data)
        item = serializer.instance
        _apply_image(item, data)
        for key, value in data.items():
            setattr(item, key, value)
        serializer.instance = services.save_item(item)

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        services.delete_item(item, force=query_bool(request, 'force'))
        return Response(status=204)

    @action(detail=True, methods=['get'])
    def image(self, request, pk=None):
        return stream_file(self.get_object().image)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        """Stock movements with running stock, oldest first."""
        from transactions.models import PurchaseItem, SaleItem

        item = self.get_object()
        movements = []
        for line in SaleItem.objects.filter(item=item).select_related('sale').order_by('sale__date', 'sale_id'):
            sale = line.sale
            movements.append({
                'date': sale.date, 'type': 'sale', 'type_label': 'Sale', 'ref_id': sale.id, 'number': sale.number,
                'party': sale.party_name, 'quantity': -line.quantity, 'rate': line.rate, 'amount': line.amount,
                'sort': (sale.date, 1, sale.created_at.timestamp()),
            })
        for line in PurchaseItem.objects.filter(item=item).select_related('purchase').order_by(
                'purchase__date', 'purchase_id'):
            purchase = line.purchase
            movements.append({
                'date': purchase.date, 'type': 'purchase', 'type_label': 'Purchase', 'ref_id': purchase.id,
                'number': purchase.number, 'party': purchase.party_name, 'quantity': line.quantity,
                'rate': line.rate, 'amount': line.amount, 'sort': (purchase.date, 0, purchase.created_at.timestamp()),
            })
        for adj in StockAdjustment.objects.filter(item=item):
            movements.append({
                'date': adj.date, 'type': 'adjustment', 'type_label': 'Stock adjustment', 'ref_id': adj.id,
                'number': '', 'party': adj.note, 'quantity': adj.quantity, 'rate': None, 'amount': None,
                'sort': (adj.date, 2, adj.created_at.timestamp()),
            })
        movements.sort(key=lambda m: m['sort'])
        running = item.opening_stock
        rows = [{'date': item.created_at.date(), 'type': 'opening', 'type_label': 'Opening stock', 'ref_id': None,
                 'number': '', 'party': '', 'quantity': str(item.opening_stock), 'rate': None, 'amount': None,
                 'stock': str(running)}]
        for m in movements:
            running += m['quantity']
            m.pop('sort')
            rows.append({**m, 'quantity': str(m['quantity']), 'rate': str(m['rate']) if m['rate'] is not None else None,
                         'amount': str(m['amount']) if m['amount'] is not None else None, 'stock': str(running)})
        rows.reverse()
        sales = SaleItem.objects.filter(item=item).aggregate(q=Sum('quantity'), a=Sum('amount'))
        purchases = PurchaseItem.objects.filter(item=item).aggregate(q=Sum('quantity'), a=Sum('amount'))
        return Response({
            'item': ItemSerializer(item, context=self.get_serializer_context()).data,
            'totals': {
                'sold_qty': qty_str(sales['q']), 'sales_amount': money_str(sales['a']),
                'purchased_qty': qty_str(purchases['q']), 'purchase_amount': money_str(purchases['a']),
            },
            'results': rows,
        })

    @action(detail=True, methods=['post'], url_path='adjust-stock')
    def adjust_stock(self, request, pk=None):
        item = self.get_object()
        serializer = StockAdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        adjustment = services.adjust_stock(item, data['quantity'], data.get('date') or today(), data.get('note', ''))
        item.refresh_from_db()
        return Response({
            'adjustment': StockAdjustmentSerializer(adjustment).data,
            'item': ItemSerializer(item, context=self.get_serializer_context()).data,
        }, status=201)


class StockAdjustmentViewSet(BusinessScopedMixin, viewsets.GenericViewSet):
    model = StockAdjustment
    serializer_class = StockAdjustmentSerializer

    def destroy(self, request, *args, **kwargs):
        services.delete_adjustment(self.get_object())
        return Response(status=204)
