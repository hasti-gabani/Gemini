from rest_framework.routers import SimpleRouter

from .views import PartyViewSet, ReminderViewSet

router = SimpleRouter()
router.register('parties', PartyViewSet, basename='party')
router.register('reminders', ReminderViewSet, basename='reminder')

urlpatterns = router.urls
