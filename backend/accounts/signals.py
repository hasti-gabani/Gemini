from django.db.models.signals import post_delete, pre_save
from django.dispatch import receiver

from core.files import delete_stored_file_on_commit

from .models import Business


@receiver(pre_save, sender=Business)
def remove_replaced_logo(sender, instance, **kwargs):
    if not instance.pk:
        return
    old = Business.objects.filter(pk=instance.pk).values_list('logo', flat=True).first()
    if old and old != (instance.logo.name if instance.logo else None):
        delete_stored_file_on_commit(instance.logo.storage, old)


@receiver(post_delete, sender=Business)
def remove_logo_file(sender, instance, **kwargs):
    if instance.logo:
        delete_stored_file_on_commit(instance.logo.storage, instance.logo.name)
