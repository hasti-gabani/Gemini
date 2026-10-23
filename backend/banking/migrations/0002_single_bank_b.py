from django.db import migrations


def single_bank_b(apps, schema_editor):
    # Uses the live models and service so extra banks are merged exactly as the app does it.
    from accounts.models import Business
    from banking.services import ensure_single_bank

    for business in Business.objects.all():
        ensure_single_bank(business)


class Migration(migrations.Migration):

    dependencies = [
        ('banking', '0001_initial'),
        ('accounts', '0004_delete_pin'),
        ('transactions', '0001_initial'),
        ('ledger', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(single_bank_b, migrations.RunPython.noop),
    ]
