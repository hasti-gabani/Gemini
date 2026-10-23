from django.db import migrations


def cash_into_bank(apps, schema_editor):
    # Uses the live models and service so the money moves exactly as the app does it.
    from accounts.models import Business
    from banking.services import move_cash_to_bank

    for business in Business.objects.all():
        move_cash_to_bank(business)


class Migration(migrations.Migration):

    dependencies = [
        ('banking', '0002_single_bank_b'),
    ]

    operations = [
        migrations.RunPython(cash_into_bank, migrations.RunPython.noop),
    ]
