from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.response import Response


class BusinessScopedMixin:
    """Limits a ViewSet to the signed-in user's business.

    Subclasses define `model` (or `queryset`) and may override
    `scope_queryset(qs)` to add select_related/prefetch/filters.
    """

    model = None

    @property
    def business(self):
        return self.request.user.business

    def base_queryset(self):
        model = self.model or self.queryset.model
        return model.objects.filter(business=self.business)

    def scope_queryset(self, qs):
        return qs

    def get_queryset(self):
        return self.scope_queryset(self.base_queryset())

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['business'] = self.business
        return context

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            self.perform_destroy(instance)
        except ProtectedError:
            return Response(
                {'detail': 'This record is used by other entries and cannot be deleted.', 'errors': {}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


def query_bool(request, name, default=False):
    value = request.query_params.get(name)
    if value in (None, ''):
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')
