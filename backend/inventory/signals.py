from django.db.models.signals import post_delete, pre_save
from django.dispatch import receiver

from core.files import delete_stored_file_on_commit

from .models import Item


@receiver(pre_save, sender=Item)
def remove_replaced_image(sender, instance, **kwargs):
    if not instance.pk:
        return
    old = Item.objects.filter(pk=instance.pk).values_list('image', flat=True).first()
    if old and old != (instance.image.name if instance.image else None):
        delete_stored_file_on_commit(instance.image.storage, old)


@receiver(post_delete, sender=Item)
def remove_image_file(sender, instance, **kwargs):
    if instance.image:
        delete_stored_file_on_commit(instance.image.storage, instance.image.name)
