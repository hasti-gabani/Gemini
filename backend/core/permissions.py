from rest_framework.permissions import SAFE_METHODS, BasePermission


class HasBusiness(BasePermission):
    """Authenticated user attached to a business. All data is scoped to it."""

    message = 'Please sign in to continue.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and getattr(user, 'business_id', None))


class OwnerForChanges(HasBusiness):
    """Anyone in the business may read; only the owner may change business-wide settings."""

    message = 'Only the business owner can change this.'

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.method in SAFE_METHODS or request.user.role == request.user.ROLE_OWNER


class OwnerOnly(HasBusiness):
    """Whole-business exports and maintenance are limited to the owner."""

    message = 'Only the business owner can do this.'

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.role == request.user.ROLE_OWNER
