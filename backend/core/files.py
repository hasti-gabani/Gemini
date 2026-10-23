"""Upload validation, image optimisation and file streaming helpers."""
import mimetypes
import os
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse, Http404
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework import serializers

IMAGE_TYPES = {
    'jpeg': ('image/jpeg', '.jpg'),
    'png': ('image/png', '.png'),
    'webp': ('image/webp', '.webp'),
}
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.pdf'}
MAX_IMAGE_PX = 2000


def sniff_kind(head):
    if head.startswith(b'\xff\xd8\xff'):
        return 'jpeg'
    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'webp'
    if head.startswith(b'%PDF-'):
        return 'pdf'
    return None


def validate_upload(upload, allow_pdf=True, max_mb=None):
    """Validate type (by magic bytes, not just extension) and size.
    Returns 'image' or 'pdf'."""
    max_mb = max_mb or settings.MAX_UPLOAD_MB
    if upload is None:
        raise serializers.ValidationError('Please choose a file.')
    if upload.size > max_mb * 1024 * 1024:
        raise serializers.ValidationError(f'File is too large. Maximum size is {max_mb} MB.')
    ext = os.path.splitext(upload.name or '')[1].lower()
    if ext and ext not in ALLOWED_EXTENSIONS:
        raise serializers.ValidationError('Only JPG, PNG, WEBP and PDF files are allowed.')
    upload.seek(0)
    head = upload.read(16)
    upload.seek(0)
    kind = sniff_kind(head)
    if kind is None or (kind == 'pdf' and not allow_pdf):
        allowed = 'JPG, PNG, WEBP or PDF' if allow_pdf else 'JPG, PNG or WEBP'
        raise serializers.ValidationError(f'Unsupported file. Please upload a {allowed} file.')
    if kind == 'pdf':
        return 'pdf'
    try:
        with Image.open(upload) as img:
            img.verify()
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise serializers.ValidationError('This image appears to be damaged. Please try another file.')
    finally:
        upload.seek(0)
    return 'image'


def optimize_image(upload, max_px=MAX_IMAGE_PX, quality=84):
    """Downscale big photos (e.g. phone camera screenshots) and re-encode.
    Returns (ContentFile, content_type, extension)."""
    upload.seek(0)
    raw = upload.read()
    upload.seek(0)
    with Image.open(BytesIO(raw)) as img:
        fmt = (img.format or '').lower()
        img = ImageOps.exif_transpose(img)
        too_big = max(img.size) > max_px or len(raw) > 1_500_000
        if not too_big and fmt in IMAGE_TYPES:
            content_type, ext = IMAGE_TYPES[fmt]
            return ContentFile(raw), content_type, ext
        img.thumbnail((max_px, max_px), Image.LANCZOS)
        has_alpha = img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info)
        out = BytesIO()
        if has_alpha:
            img.save(out, format='WEBP', quality=quality, method=4)
            return ContentFile(out.getvalue()), 'image/webp', '.webp'
        img.convert('RGB').save(out, format='JPEG', quality=quality, optimize=True, progressive=True)
        return ContentFile(out.getvalue()), 'image/jpeg', '.jpg'


def safe_basename(name, fallback='file'):
    base = os.path.basename(name or '') or fallback
    keep = ''.join(ch for ch in base if ch.isalnum() or ch in ' ._-()')
    return (keep.strip() or fallback)[:120]


def stream_file(field_file, filename=None, as_attachment=False, content_type=None):
    if not field_file:
        raise Http404
    try:
        handle = field_file.open('rb')
    except (FileNotFoundError, OSError):
        raise Http404
    name = filename or os.path.basename(field_file.name)
    ctype = content_type or mimetypes.guess_type(name)[0] or 'application/octet-stream'
    response = FileResponse(handle, content_type=ctype, as_attachment=as_attachment, filename=name)
    response['Cache-Control'] = 'private, max-age=3600'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


def delete_stored_file_on_commit(storage, name):
    """Remove a stored file once the surrounding transaction commits.

    Deleting straight away would lose the file for good if the transaction rolls
    back (a failed restore, cleanup or bill delete) while the row comes back.
    Outside a transaction the callback runs immediately.
    """
    if not name:
        return

    def remove():
        try:
            storage.delete(name)
        except OSError:
            pass

    transaction.on_commit(remove)
