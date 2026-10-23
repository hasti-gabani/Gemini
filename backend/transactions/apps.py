from django.apps import AppConfig


class TransactionsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'transactions'
    verbose_name = 'Sales, Purchases & Payments'

    def ready(self):
        from . import signals  # noqa: F401
