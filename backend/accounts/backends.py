from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

from core.validators import clean_phone


class FlexibleLoginBackend(ModelBackend):
    """Sign in with username, email or mobile number."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or not password:
            return None
        User = get_user_model()
        identifier = username.strip()
        query = Q(username__iexact=identifier) | Q(email__iexact=identifier)
        try:
            phone = clean_phone(identifier)
        except Exception:
            phone = ''
        if phone:
            query |= Q(phone=phone)
        for user in User.objects.filter(query).order_by('id')[:3]:
            if user.check_password(password) and self.user_can_authenticate(user):
                return user
        # Mitigate timing differences between existing and unknown users
        User().set_password(password)
        return None
