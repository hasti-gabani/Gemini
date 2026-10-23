"""HTTP helpers for PDF / Excel downloads and document headers."""
import os
import re
from urllib.parse import quote

from django.http import HttpResponse
from django.utils import timezone

PDF = 'application/pdf'
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
ZIP = 'application/zip'


def safe_filename(name, ext):
    base = re.sub(r'[\\/:*?"<>|\r\n\t]+', ' ', name or '').strip()
    base = re.sub(r'\s+', ' ', base)[:80].strip(' .') or 'document'
    return f'{base}.{ext}'


def file_response(content, filename, content_type, inline=False):
    response = HttpResponse(content, content_type=content_type)
    disposition = 'inline' if inline else 'attachment'
    ascii_name = filename.encode('ascii', 'ignore').decode() or 'download'
    response['Content-Disposition'] = (
        f'{disposition}; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'
    )
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


def pdf_response(content, name, inline=True):
    return file_response(content, safe_filename(name, 'pdf'), PDF, inline=inline)


def xlsx_response(content, name):
    return file_response(content, safe_filename(name, 'xlsx'), XLSX)


def business_header(business):
    """Business block used at the top of every PDF / Excel export."""
    logo_path = None
    settings = getattr(business, 'settings', None)
    if business.logo and (settings is None or settings.show_logo):
        try:
            path = business.logo.path
            logo_path = path if os.path.exists(path) else None
        except (ValueError, NotImplementedError):
            logo_path = None
    show_gst = settings.show_gst if settings is not None else True
    return {
        'name': business.name,
        'address': business.full_address,
        'phone': business.phone,
        'email': business.email,
        'gstin': business.gstin if show_gst else '',
        'logo_path': logo_path,
    }


def generated_at():
    return timezone.localtime().strftime('%d/%m/%Y %I:%M %p')
