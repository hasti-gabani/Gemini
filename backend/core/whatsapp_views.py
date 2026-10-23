"""Settings → WhatsApp: link WhatsApp numbers (by QR code, or by a code typed on the phone), see which are
linked, unlink them. Each device then sends bills from the number chosen on it."""
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from parties.reminders import whatsapp_number

from . import whatsapp
from .permissions import HasBusiness, OwnerOnly


def _account_view(account):
    return {key: account.get(key) for key in ('id', 'status', 'phone', 'code', 'error')}


class WhatsAppStatusView(APIView):
    permission_classes = [HasBusiness]

    def get(self, request):
        status = whatsapp.local_status()
        if status is None:
            return Response({'status': 'not_running', 'qr': None, 'phone': None, 'accounts': [],
                             'business_api': whatsapp.meta_configured()})
        return Response({'status': status.get('status'), 'qr': status.get('qr'), 'phone': status.get('phone'),
                         'accounts': [_account_view(a) for a in status.get('accounts', [])],
                         'business_api': whatsapp.meta_configured()})


class WhatsAppLinkView(APIView):
    """Link a phone's WhatsApp without a scanner: returns the account id; poll the status for its code."""

    permission_classes = [HasBusiness]

    def post(self, request):
        number = whatsapp_number(request.data.get('phone'))
        if len(number) < 12:
            raise ValidationError({'phone': 'Enter the 10-digit mobile number that has this WhatsApp.'})
        return Response({'id': whatsapp.local_link(number)})


class WhatsAppLogoutView(APIView):
    permission_classes = [OwnerOnly]

    def post(self, request):
        whatsapp.local_logout(request.data.get('id') or None)
        return Response({'detail': 'WhatsApp unlinked.'})
