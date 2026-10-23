"""Security: closed sign-up, sign-in lockout, session timeouts and response headers."""
import time
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import LoginGuard, User
from accounts.services import bootstrap_business


class SecurityTests(TestCase):
    def setUp(self):
        cache.clear()
        business = bootstrap_business('Hari Traders')
        self.user = User.objects.create_user(username='owner', email='owner@example.com', phone='9876543210',
                                             password='right-pass-123', business=business)
        self.client = APIClient()

    def login(self, username='owner', password='right-pass-123'):
        return self.client.post('/api/auth/login/', {'username': username, 'password': password}, format='json')

    def test_public_sign_up_is_closed(self):
        r = self.client.post('/api/auth/register/', {'name': 'Stranger', 'business_name': 'Unknown Co',
                                                     'phone': '9123456780', 'password': 'another-pass-77'},
                             format='json')
        self.assertEqual(r.status_code, 403)
        self.assertFalse(self.client.get('/api/auth/session/').data['registration_open'])
        self.assertEqual(User.objects.count(), 1)

    def test_five_wrong_passwords_lock_the_account(self):
        for _ in range(4):
            self.assertEqual(self.login(password='wrong-pass').status_code, 400)
        r = self.login(password='wrong-pass')
        self.assertEqual(r.status_code, 429)
        self.assertIn('15 minutes', r.data['detail'])
        # While locked even the right password is refused, whichever login name is typed.
        self.assertEqual(self.login().status_code, 429)
        self.assertEqual(self.login(username='98765 43210').status_code, 429)
        self.assertEqual(self.login(username='OWNER@example.com').status_code, 429)
        # Once the lock has passed, the right password works and clears the counter.
        LoginGuard.objects.update(locked_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.login().status_code, 200)
        self.assertFalse(LoginGuard.objects.filter(key=f'user:{self.user.id}').exists())

    def test_unknown_login_names_are_locked_too(self):
        for _ in range(5):
            r = self.login(username='nobody', password='guess')
        self.assertEqual(r.status_code, 429)

    @override_settings(USE_X_FORWARDED_FOR=True, LOGIN_MAX_FAILURES_PER_ADDRESS=3)
    def test_address_behind_a_proxy_cannot_be_faked(self):
        # The proxy appends the real address; a visitor changing the first one is still the same address.
        def attempt(n, username, password):
            return self.client.post('/api/auth/login/', {'username': username, 'password': password},
                                    format='json', HTTP_X_FORWARDED_FOR=f'10.0.0.{n}, 203.0.113.9')

        for n in range(3):
            self.assertEqual(attempt(n, f'guess{n}', 'x').status_code, 400)
        self.assertEqual(attempt(9, 'owner', 'right-pass-123').status_code, 429)
        self.assertTrue(LoginGuard.objects.filter(key='ip:203.0.113.9', locked_until__isnull=False).exists())

    def test_idle_session_is_signed_out(self):
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.client.get('/api/parties/').status_code, 200)
        session = self.client.session
        session['last_seen'] = int(time.time()) - 61 * 60
        session.save()
        r = self.client.get('/api/parties/')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data['code'], 'session_expired')
        self.assertIn('60 minutes without activity', r.data['detail'])
        self.assertFalse(self.client.get('/api/auth/session/').data['authenticated'])

    def test_session_ends_after_the_maximum_age(self):
        self.assertEqual(self.login().status_code, 200)
        session = self.client.session
        session['login_at'] = int(time.time()) - 13 * 60 * 60
        session.save()
        r = self.client.get('/api/parties/')
        self.assertEqual(r.status_code, 403)
        self.assertIn('12 hours', r.data['detail'])

    def test_security_headers(self):
        page = self.client.get('/sales/new')  # any app route returns the web app's HTML
        self.assertEqual(page.status_code, 200)
        self.assertIn("default-src 'self'", page['Content-Security-Policy'])
        self.assertIn("script-src 'self'", page['Content-Security-Policy'])
        self.assertEqual(page['X-Frame-Options'], 'DENY')
        self.assertEqual(page['X-Content-Type-Options'], 'nosniff')
        api = self.client.get('/api/health/')
        self.assertNotIn('Content-Security-Policy', api)
        self.assertEqual(api['X-Frame-Options'], 'DENY')
        # The Django admin is not reachable unless ADMIN_URL is configured.
        self.assertNotIn(b'Django administration', self.client.get('/django-admin/').content)
