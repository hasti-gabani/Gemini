from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register('sales', views.SaleViewSet, basename='sale')
router.register('purchases', views.PurchaseViewSet, basename='purchase')
router.register('payments-in', views.PaymentInViewSet, basename='payment-in')
router.register('payments-out', views.PaymentOutViewSet, basename='payment-out')
router.register('attachments', views.AttachmentViewSet, basename='attachment')

urlpatterns = router.urls + [
    path('transactions/bulk-delete/', views.BulkDeleteView.as_view()),
    path('public/documents/<str:token>/', views.PublicDocumentView.as_view()),
    path('public/documents/<str:token>/pdf/', views.PublicDocumentPdfView.as_view()),
    path('public/documents/<str:token>/logo/', views.PublicLogoView.as_view()),
]
