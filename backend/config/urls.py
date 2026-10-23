import re

from django.conf import settings
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path

from core.spa import spa_index
from core.whatsapp_views import WhatsAppLinkView, WhatsAppLogoutView, WhatsAppStatusView


def health(request):
    return JsonResponse({'status': 'ok', 'app': settings.APP_NAME})


def api_not_found(request, *args, **kwargs):
    return JsonResponse({'detail': 'API endpoint not found.', 'errors': {}}, status=404)


api_patterns = [
    path('health/', health),
    path('whatsapp/status/', WhatsAppStatusView.as_view()),
    path('whatsapp/link/', WhatsAppLinkView.as_view()),
    path('whatsapp/logout/', WhatsAppLogoutView.as_view()),
    path('', include('accounts.urls')),
    path('', include('parties.urls')),
    path('', include('inventory.urls')),
    path('', include('banking.urls')),
    path('', include('transactions.urls')),
    path('', include('reports.urls')),
    path('', include('datamgmt.urls')),
]

urlpatterns = [
    path('api/', include(api_patterns)),
    re_path(r'^api/', api_not_found),
]
if settings.ADMIN_URL:
    # Only reachable when ADMIN_URL is set in .env; the address is not linked anywhere.
    urlpatterns.append(path(f'{settings.ADMIN_URL}/', admin.site.urls))
    SPA_EXCLUDE = rf'api/|static/|{re.escape(settings.ADMIN_URL)}/'
else:
    SPA_EXCLUDE = r'api/|static/'
urlpatterns.append(re_path(rf'^(?!{SPA_EXCLUDE}).*$', spa_index))
