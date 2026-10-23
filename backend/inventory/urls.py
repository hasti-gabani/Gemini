from rest_framework.routers import SimpleRouter

from .views import CategoryViewSet, ItemViewSet, StockAdjustmentViewSet

router = SimpleRouter()
router.register('categories', CategoryViewSet, basename='category')
router.register('items', ItemViewSet, basename='item')
router.register('stock-adjustments', StockAdjustmentViewSet, basename='stock-adjustment')

urlpatterns = router.urls
