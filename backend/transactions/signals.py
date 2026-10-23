from django.db.models.signals import post_delete
from django.dispatch import receiver

from core.files import delete_stored_file_on_commit

from .models import Attachment


@receiver(post_delete, sender=Attachment)
def remove_attachment_file(sender, instance, **kwargs):
    if instance.file:
        delete_stored_file_on_commit(instance.file.storage, instance.file.name)
