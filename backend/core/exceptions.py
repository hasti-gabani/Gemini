"""Uniform, friendly API error responses.

Every error response has the shape:
    {"detail": "Human readable message", "errors": {"field.path": "message", ...}}
"""
import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import ProtectedError
from django.http import Http404, JsonResponse
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)

FIELD_LABELS = {
    'non_field_errors': '',
}


def _flatten(data, prefix=''):
    flat = {}
    if isinstance(data, dict):
        for key, value in data.items():
            path = f'{prefix}.{key}' if prefix else str(key)
            flat.update(_flatten(value, path))
    elif isinstance(data, (list, tuple)):
        if data and all(not isinstance(v, (dict, list, tuple)) for v in data):
            flat[prefix or 'detail'] = str(data[0])
        else:
            for index, value in enumerate(data):
                if value in ({}, [], None, ''):
                    continue
                flat.update(_flatten(value, f'{prefix}.{index}' if prefix else str(index)))
    elif data not in (None, ''):
        flat[prefix or 'detail'] = str(data)
    return flat


def csrf_failure(request, reason=''):
    """CSRF_FAILURE_VIEW: the web app expects JSON errors, not Django's HTML page."""
    logger.warning('CSRF failure on %s: %s', request.path, reason)
    return JsonResponse(
        {'detail': 'Your session has expired or the page is out of date. Please reload the page and try again.',
         'errors': {}},
        status=403,
    )


def api_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(getattr(exc, 'message_dict', None) or exc.messages)
    elif isinstance(exc, ProtectedError):
        return Response(
            {'detail': 'This record is used by other entries and cannot be deleted.', 'errors': {}},
            status=status.HTTP_409_CONFLICT,
        )
    elif isinstance(exc, IntegrityError):
        logger.warning('Integrity error: %s', exc)
        return Response(
            {'detail': 'This record conflicts with an existing entry (duplicate number or name).', 'errors': {}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound('Record not found. It may have been deleted.')

    response = exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    if isinstance(exc, exceptions.ValidationError):
        errors = _flatten(data)
        detail = errors.pop('detail', None) or errors.pop('non_field_errors', None)
        if not detail:
            detail = next(iter(errors.values()), 'Please check the highlighted fields.')
        response.data = {'detail': detail, 'errors': errors}
    elif isinstance(data, dict) and 'detail' in data:
        response.data = {'detail': str(data['detail']), 'errors': {}}
        if 'code' in data:  # e.g. a specific error the app reacts to
            response.data['code'] = str(data['code'])
    else:
        response.data = {'detail': str(data), 'errors': {}}

    if isinstance(exc, exceptions.NotAuthenticated):
        response.data['detail'] = 'Please sign in to continue.'
    if response.status_code in (401, 403):
        request = context.get('request')
        reason = getattr(getattr(request, '_request', request), 'session_timed_out', None)
        if reason:
            from .middleware import timeout_message
            response.data['detail'] = timeout_message(reason)
            response.data['code'] = 'session_expired'
    return response
