"""
Django settings for the Gemini accounting backend.

Configuration comes from environment variables (optionally loaded from
backend/.env or the project-root .env). See .env.example for all options.
"""
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent

load_dotenv(BASE_DIR / '.env')
load_dotenv(PROJECT_ROOT / '.env')


def env(name, default=None):
    value = os.environ.get(name)
    return default if value in (None, '') else value


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value in (None, ''):
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')


def env_list(name, default=''):
    raw = env(name, default) or ''
    return [part.strip() for part in raw.split(',') if part.strip()]


# Debug defaults to on only for the development server; production WSGI servers
# (waitress / gunicorn) run with DEBUG off unless DEBUG=True is set explicitly.
RUNNING_DEVSERVER = len(sys.argv) > 1 and sys.argv[1] == 'runserver'
TESTING = len(sys.argv) > 1 and sys.argv[1] == 'test'
DEBUG = env_bool('DEBUG', RUNNING_DEVSERVER)


def _secret_key():
    key = env('SECRET_KEY')
    if key:
        return key
    # Persist a random key per installation so sessions survive restarts.
    key_file = BASE_DIR / '.secret_key'
    if key_file.exists():
        return key_file.read_text(encoding='utf-8').strip()
    key = secrets.token_urlsafe(50)
    key_file.write_text(key, encoding='utf-8')
    return key


SECRET_KEY = _secret_key()

ALLOWED_HOSTS = env_list('ALLOWED_HOSTS', '*' if DEBUG else 'localhost,127.0.0.1')
CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS', '')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'core',
    'accounts',
    'parties',
    'inventory',
    'banking',
    'transactions',
    'ledger',
    'reports',
    'datamgmt',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'core.middleware.SecurityHeadersMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'core.middleware.SessionTimeoutMiddleware',
    'datamgmt.middleware.AutoBackupMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]


def _database_config():
    url = env('DATABASE_URL')
    if not url:
        return {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': env('SQLITE_PATH', str(BASE_DIR / 'db.sqlite3')),
            'OPTIONS': {
                'timeout': 20,
                'transaction_mode': 'IMMEDIATE',
            },
        }
    parsed = urlparse(url)
    if parsed.scheme in ('postgres', 'postgresql', 'pgsql'):
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': unquote(parsed.path.lstrip('/')),
            'USER': unquote(parsed.username or ''),
            'PASSWORD': unquote(parsed.password or ''),
            'HOST': parsed.hostname or '',
            'PORT': str(parsed.port or ''),
            'CONN_MAX_AGE': int(env('DB_CONN_MAX_AGE', '60')),
        }
    if parsed.scheme == 'sqlite':
        return {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': unquote(parsed.path.lstrip('/')) or str(BASE_DIR / 'db.sqlite3'),
            'OPTIONS': {'timeout': 20, 'transaction_mode': 'IMMEDIATE'},
        }
    raise ValueError(f'Unsupported DATABASE_URL scheme: {parsed.scheme}')


DATABASES = {'default': _database_config()}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

AUTH_USER_MODEL = 'accounts.User'
AUTHENTICATION_BACKENDS = ['accounts.backends.FlexibleLoginBackend']

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 6}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
]

LANGUAGE_CODE = 'en-in'
TIME_ZONE = env('TIME_ZONE', 'Asia/Kolkata')
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'  # not publicly routed; files are streamed through authenticated views
MEDIA_ROOT = Path(env('MEDIA_ROOT', str(BASE_DIR / 'media')))

FRONTEND_DIST = Path(env('FRONTEND_DIST', str(PROJECT_ROOT / 'frontend' / 'dist')))
if FRONTEND_DIST.exists():
    WHITENOISE_ROOT = FRONTEND_DIST
WHITENOISE_INDEX_FILE = False


def _immutable_file_test(path, url):
    # Vite emits content-hashed files under /assets/
    return url.startswith('/assets/')


WHITENOISE_IMMUTABLE_FILE_TEST = _immutable_file_test
WHITENOISE_MIMETYPES = {'.webmanifest': 'application/manifest+json'}

# Sessions & CSRF (the SPA is served from the same origin as the API)
# Signed out after SESSION_IDLE_MINUTES without activity, and SESSION_MAX_HOURS after
# signing in however active (core.middleware.SessionTimeoutMiddleware).
SESSION_IDLE_MINUTES = int(env('SESSION_IDLE_MINUTES', '60'))
SESSION_MAX_HOURS = int(env('SESSION_MAX_HOURS', '12'))
SESSION_COOKIE_AGE = SESSION_MAX_HOURS * 60 * 60
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_NAME = 'gemini_session'
CSRF_COOKIE_NAME = 'gemini_csrftoken'
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_FAILURE_VIEW = 'core.exceptions.csrf_failure'
# Pages may not be framed by other sites (clickjacking). The one view the app frames itself,
# the attachment preview, allows its own origin explicitly.
X_FRAME_OPTIONS = 'DENY'
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'

# Sign-in lockout (accounts.security): LOGIN_MAX_FAILURES wrong passwords lock the account for
# LOGIN_LOCK_MINUTES. Behind a reverse proxy set USE_X_FORWARDED_FOR=True for real client IPs.
LOGIN_MAX_FAILURES = int(env('LOGIN_MAX_FAILURES', '5'))
LOGIN_LOCK_MINUTES = int(env('LOGIN_LOCK_MINUTES', '15'))
LOGIN_MAX_FAILURES_PER_ADDRESS = int(env('LOGIN_MAX_FAILURES_PER_ADDRESS', '20'))
USE_X_FORWARDED_FOR = env_bool('USE_X_FORWARDED_FOR', False)

# Serve over HTTPS on the internet: set USE_HTTPS=True (see README "Putting the app online").
# The development server (runserver) never speaks HTTPS, so it ignores this setting; a production
# .env on the same PC then cannot break local development.
USE_HTTPS = env_bool('USE_HTTPS', False) and not RUNNING_DEVSERVER
if USE_HTTPS:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', True)
    SECURE_HSTS_SECONDS = int(env('SECURE_HSTS_SECONDS', str(60 * 60 * 24 * 365)))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool('SECURE_HSTS_INCLUDE_SUBDOMAINS', True)
    SECURE_HSTS_PRELOAD = env_bool('SECURE_HSTS_PRELOAD', True)

# Django admin is off unless ADMIN_URL is set to a hard-to-guess path, e.g. "manage-7f3k9/".
ADMIN_URL = (env('ADMIN_URL', '') or '').strip().strip('/')

# Uploads
MAX_UPLOAD_MB = int(env('MAX_UPLOAD_MB', '10'))
MAX_RESTORE_MB = int(env('MAX_RESTORE_MB', '500'))
DATA_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 5000

# Public sign-up is closed: nobody can create a new business account from the login page.
# Set ALLOW_REGISTRATION=True only while setting up a new server.
ALLOW_REGISTRATION = env_bool('ALLOW_REGISTRATION', False)

# Automatic daily backup while the app is running (datamgmt.scheduler): one ZIP per business per
# day in MEDIA_ROOT/backups, kept for AUTO_BACKUP_KEEP_DAYS days, optionally copied to the folder
# chosen in Settings (for example a Google Drive for desktop folder).
AUTO_BACKUP_ENABLED = env_bool('AUTO_BACKUP_ENABLED', not TESTING)
AUTO_BACKUP_KEEP_DAYS = int(env('AUTO_BACKUP_KEEP_DAYS', '30'))
AUTO_BACKUP_CHECK_MINUTES = int(env('AUTO_BACKUP_CHECK_MINUTES', '30'))
# Besides the daily one, a backup is also saved after data changes: once nothing has changed for
# AUTO_BACKUP_AFTER_CHANGE_SECONDS, or at the latest AUTO_BACKUP_CHANGE_MAX_WAIT_SECONDS after the
# first unsaved change. The newest AUTO_BACKUP_CHANGE_KEEP of these are kept.
AUTO_BACKUP_AFTER_CHANGE_SECONDS = int(env('AUTO_BACKUP_AFTER_CHANGE_SECONDS', '120'))
AUTO_BACKUP_CHANGE_MAX_WAIT_SECONDS = int(env('AUTO_BACKUP_CHANGE_MAX_WAIT_SECONDS', '600'))
AUTO_BACKUP_CHANGE_KEEP = int(env('AUTO_BACKUP_CHANGE_KEEP', '20'))
APP_NAME = env('APP_NAME', 'Gemini')
# Public address used in shared bill links (WhatsApp/SMS), e.g. https://billing.example.com
PUBLIC_BASE_URL = (env('PUBLIC_BASE_URL', '') or '').rstrip('/')
# Send bill / receipt PDFs straight to a party's WhatsApp (WhatsApp Business Cloud API, see core/whatsapp.py)
WHATSAPP_TOKEN = env('WHATSAPP_TOKEN', '')
WHATSAPP_PHONE_NUMBER_ID = env('WHATSAPP_PHONE_NUMBER_ID', '')
WHATSAPP_TEMPLATE = env('WHATSAPP_TEMPLATE', '')
WHATSAPP_TEMPLATE_LANGUAGE = env('WHATSAPP_TEMPLATE_LANGUAGE', 'en')
WHATSAPP_TEMPLATE_PARAMS = env_list('WHATSAPP_TEMPLATE_PARAMS', 'party,number,amount') if os.environ.get('WHATSAPP_TEMPLATE_PARAMS') != '' else []
WHATSAPP_API_VERSION = env('WHATSAPP_API_VERSION', 'v21.0')
# The owner's own WhatsApp, linked by QR code (whatsapp/service.mjs, started by scripts/runner.py)
# Tests never reach the real linked WhatsApp: they talk to a closed port (and mock it where needed).
WHATSAPP_LOCAL_URL = 'http://127.0.0.1:9' if TESTING else env('WHATSAPP_LOCAL_URL', 'http://127.0.0.1:8200')
# Without the API: send through WhatsApp Desktop on this PC (core/whatsapp_desktop.py)
WHATSAPP_DESKTOP = env_bool('WHATSAPP_DESKTOP', not TESTING)

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'core.permissions.HasBusiness',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ] + (['rest_framework.renderers.BrowsableAPIRenderer'] if DEBUG else []),
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.MultiPartParser',
        'rest_framework.parsers.FormParser',
    ],
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.StandardPagination',
    'PAGE_SIZE': 25,
    'EXCEPTION_HANDLER': 'core.exceptions.api_exception_handler',
    'DEFAULT_THROTTLE_RATES': {
        'auth': env('AUTH_THROTTLE_RATE', '20/min'),
    },
    'COERCE_DECIMAL_TO_STRING': True,
    # `?format=a4|a5|thermal80|thermal58` selects the paper size of PDFs, so DRF must not
    # treat `format` as a renderer override (it would answer 404 for "a4").
    'URL_FORMAT_OVERRIDE': None,
    'DATE_FORMAT': '%Y-%m-%d',
    'DATE_INPUT_FORMATS': ['%Y-%m-%d', '%d/%m/%Y', 'iso-8601'],
    'TEST_REQUEST_DEFAULT_FORMAT': 'json',
}

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'simple': {'format': '[{asctime}] {levelname} {name}: {message}', 'style': '{'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'simple'},
    },
    'root': {'handlers': ['console'], 'level': env('LOG_LEVEL', 'INFO')},
    'loggers': {
        'django.db.backends': {'level': 'WARNING'},
    },
}
