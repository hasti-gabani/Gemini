from django.conf import settings as django_settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.files import stream_file
from core.middleware import start_session_clock
from core.permissions import OwnerForChanges, OwnerOnly
from transactions import numbering

from . import security

from .models import User
from .serializers import (
    BusinessSerializer, ChangePasswordSerializer, LoginSerializer, RegisterSerializer, SettingsSerializer,
    UserSerializer,
)
from .services import bootstrap_business, ensure_business_ready


def session_payload(request):
    user = request.user
    if not user.is_authenticated:
        return {'authenticated': False, 'registration_open': django_settings.ALLOW_REGISTRATION}
    business = user.business
    payload = {
        'authenticated': True,
        'registration_open': django_settings.ALLOW_REGISTRATION,
        'user': UserSerializer(user).data,
        'business': None,
        'settings': None,
    }
    if business:
        ensure_business_ready(business)
        payload['business'] = BusinessSerializer(business, context={'request': request}).data
        payload['settings'] = SettingsSerializer(business.settings).data
    return payload


@method_decorator(ensure_csrf_cookie, name='dispatch')
class SessionView(APIView):
    """Returns the current session (and sets the CSRF cookie)."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(session_payload(request))


@method_decorator(csrf_protect, name='dispatch')
class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        keys = security.guard_keys(request, data['username'])
        minutes = security.locked_for(keys)
        if minutes:
            raise Throttled(detail=security.lock_message(minutes))
        user = authenticate(request, username=data['username'], password=data['password'])
        if user is None:
            if security.record_failure(keys):
                raise Throttled(detail=security.lock_message(security.lock_minutes()))
            raise ValidationError({'password': 'Incorrect login details. Please check and try again.'})
        if not user.business_id:
            raise PermissionDenied('This account is not linked to any business.')
        security.record_success(keys)
        login(request, user)
        start_session_clock(request)
        request.session.set_expiry(None if data['remember'] else 0)
        return Response(session_payload(request))


@method_decorator(csrf_protect, name='dispatch')
class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth'

    @transaction.atomic
    def post(self, request):
        if not django_settings.ALLOW_REGISTRATION:
            raise PermissionDenied('New registrations are disabled on this server.')
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        business = bootstrap_business(
            data['business_name'], phone=data.get('phone', ''), email=data.get('email', ''))
        name_parts = data['name'].split(' ', 1)
        user = User.objects.create_user(
            username=data['username'],
            email=data.get('email', ''),
            password=data['password'],
            first_name=name_parts[0][:150],
            last_name=(name_parts[1] if len(name_parts) > 1 else '')[:150],
            phone=data.get('phone', ''),
            business=business,
            role=User.ROLE_OWNER,
        )
        login(request, user, backend='accounts.backends.FlexibleLoginBackend')
        start_session_clock(request)
        return Response(session_payload(request), status=status.HTTP_201_CREATED)


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({'authenticated': False})


class ProfileView(APIView):
    def patch(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data['new_password'])
        request.user.save(update_fields=['password'])
        update_session_auth_hash(request, request.user)
        return Response({'detail': 'Password changed successfully.'})


class BusinessView(APIView):
    permission_classes = [OwnerForChanges]

    def get(self, request):
        return Response(BusinessSerializer(request.user.business, context={'request': request}).data)

    def patch(self, request):
        serializer = BusinessSerializer(request.user.business, data=request.data, partial=True,
                                        context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class BusinessLogoView(APIView):
    def get(self, request):
        return stream_file(request.user.business.logo)


class SettingsView(APIView):
    permission_classes = [OwnerForChanges]

    def get(self, request):
        return Response(SettingsSerializer(request.user.business.settings).data)

    def patch(self, request):
        serializer = SettingsSerializer(request.user.business.settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ResetShareLinksView(APIView):
    permission_classes = [OwnerOnly]

    def post(self, request):
        from .models import _share_salt
        business = request.user.business
        business.share_salt = _share_salt()
        business.save(update_fields=['share_salt', 'updated_at'])
        return Response({'detail': 'All previously shared bill links have been disabled.'})


class NextNumberView(APIView):
    def get(self, request):
        doc_type = request.query_params.get('type', 'sale')
        if doc_type not in numbering.DOC_TYPES:
            raise ValidationError({'type': 'Unknown document type.'})
        number, prefix, seq = numbering.next_number(request.user.business, doc_type)
        return Response({'type': doc_type, 'number': number, 'prefix': prefix, 'seq': seq})
