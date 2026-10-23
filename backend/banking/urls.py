from rest_framework.routers import SimpleRouter

from .views import BankAccountViewSet, BankAdjustmentViewSet

router = SimpleRouter()
router.register('accounts', BankAccountViewSet, basename='account')
router.register('bank-adjustments', BankAdjustmentViewSet, basename='bank-adjustment')

urlpatterns = router.urls
