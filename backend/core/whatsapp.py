"""Send a bill / receipt PDF straight to a party's WhatsApp number.

Two ways, the first one that is available is used:

1. WhatsApp Business Cloud API (Meta, official) when .env has WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and
   WHATSAPP_TEMPLATE (an approved template with a DOCUMENT header). See WHATSAPP_SETUP.md:

    WHATSAPP_TOKEN            permanent access token of the WhatsApp Business app (system user)
    WHATSAPP_PHONE_NUMBER_ID  "Phone number ID" from WhatsApp Manager / API Setup (not the number)
    WHATSAPP_TEMPLATE         name of the approved template with a DOCUMENT header (e.g. invoice_pdf)
    WHATSAPP_TEMPLATE_LANGUAGE  its language code (default en)
    WHATSAPP_TEMPLATE_PARAMS  the template body's {{1}}, {{2}}, ... in order (default party,number,amount);
                              any of: party, number, amount, balance, date, business. Empty for none.

2. The owner's own WhatsApp, linked once like WhatsApp Web (Settings → WhatsApp → scan the QR code). The
   small service in whatsapp/service.mjs keeps that link and sends from this computer (WHATSAPP_LOCAL_URL).
"""
import base64
import json
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from rest_framework.exceptions import ValidationError

from parties.reminders import whatsapp_number

TIMEOUT = 30


# --------------------------------------------------------------------------- own WhatsApp (linked by QR)

def _local(method, path, payload=None, timeout=3):
    """Call the WhatsApp service on this computer. None when it is not running."""
    request = Request(settings.WHATSAPP_LOCAL_URL.rstrip('/') + path, method=method,
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers={'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read() or b'{}')
    except HTTPError as error:
        try:
            message = json.loads(error.read() or b'{}').get('error')
        except ValueError:
            message = None
        raise ValidationError({'detail': message or f'The WhatsApp service answered with error {error.code}.'}) from None
    except (URLError, TimeoutError, OSError):
        return None


def local_status():
    """The QR-linked number ({'status': 'starting' | 'qr' | 'connected' | 'offline', 'qr', 'phone'}) plus
    'accounts': every linked number (also those linked by code). None when the service is not running."""
    return _local('GET', '/status', timeout=2)


def linked_numbers(status=None):
    status = status if status is not None else local_status()
    return [a for a in (status or {}).get('accounts', []) if a.get('status') == 'connected']


def local_link(phone):
    """Start linking `phone` without a scanner; its 8-character code then shows in local_status()."""
    result = _local('POST', '/link', {'phone': whatsapp_number(phone)}, timeout=10)
    if result is None:
        raise ValidationError({'detail': 'The WhatsApp service is not running. Start Gemini with "Start Gemini.bat".'})
    return result.get('id')


def local_logout(account=None):
    return _local('POST', '/logout', {'id': account} if account else {}, timeout=10)


PREVIEW_WIDTH = 480  # px, like the preview WhatsApp shows above a PDF


def pdf_preview(content):
    """First page of the PDF as a small JPEG and the page count, so WhatsApp shows the bill above the file
    ("1 page · PDF"). None when it cannot be made; the PDF is then sent without a preview."""
    try:
        import pymupdf
        with pymupdf.open(stream=content, filetype='pdf') as pdf:
            page = pdf[0]
            zoom = PREVIEW_WIDTH / page.rect.width
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            return {'jpeg': pixmap.tobytes('jpeg', jpg_quality=75), 'width': pixmap.width,
                    'height': pixmap.height, 'pages': pdf.page_count}
    except Exception:  # noqa: BLE001 - a missing preview must never stop the bill from being sent
        return None


def _send_local(number, content, filename, caption, account=None):
    status = local_status()
    if status is None:
        raise ValidationError({'detail': 'The WhatsApp service is not running. Start Gemini with "Start Gemini.bat".'})
    if not linked_numbers(status):
        raise ValidationError({'detail': 'WhatsApp is not linked. Open Settings → WhatsApp and link your number.'})
    payload = {'phone': number, 'filename': filename, 'caption': caption, 'pdf_base64': base64.b64encode(content).decode(),
               'account': account or ''}  # the number linked on the device that sends; else the main one
    preview = pdf_preview(content)
    if preview:
        payload.update(thumbnail_base64=base64.b64encode(preview['jpeg']).decode(), thumbnail_width=preview['width'],
                       thumbnail_height=preview['height'], page_count=preview['pages'])
    result = _local('POST', '/send', payload, timeout=90)
    if result is None:
        raise ValidationError({'detail': 'Could not reach the WhatsApp service. Try again.'})
    return result.get('number') or number


# --------------------------------------------------------------------------- WhatsApp Business Cloud API (Meta)

def meta_configured():
    return bool(settings.WHATSAPP_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID and settings.WHATSAPP_TEMPLATE)


def _url(path):
    return f'https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{settings.WHATSAPP_PHONE_NUMBER_ID}/{path}'


def _call(request):
    request.add_header('Authorization', f'Bearer {settings.WHATSAPP_TOKEN}')
    try:
        with urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read() or b'{}')
    except HTTPError as error:
        try:
            info = json.loads(error.read() or b'{}').get('error') or {}
        except ValueError:
            info = {}
        detail = (info.get('error_data') or {}).get('details') or info.get('message') or f'HTTP {error.code}'
        raise ValidationError({'detail': f'WhatsApp did not send the PDF: {detail}'}) from None
    except (URLError, TimeoutError, OSError):
        raise ValidationError({'detail': 'Could not reach WhatsApp. Check the internet connection and try again.'}) from None


def _upload(content, filename):
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in (('messaging_product', 'whatsapp'), ('type', 'application/pdf')):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                 'Content-Type: application/pdf\r\n\r\n'.encode('utf-8') + content + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    request = Request(_url('media'), data=b''.join(parts), method='POST',
                      headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    media_id = _call(request).get('id')
    if not media_id:
        raise ValidationError({'detail': 'WhatsApp did not accept the PDF upload.'})
    return media_id


def _send_meta(number, content, filename, values):
    media_id = _upload(content, filename)
    components = [{'type': 'header', 'parameters': [
        {'type': 'document', 'document': {'id': media_id, 'filename': filename}}]}]
    body = [{'type': 'text', 'text': str(values.get(key, '') or '-')} for key in settings.WHATSAPP_TEMPLATE_PARAMS]
    if body:
        components.append({'type': 'body', 'parameters': body})
    payload = {
        'messaging_product': 'whatsapp',
        'to': number,
        'type': 'template',
        'template': {'name': settings.WHATSAPP_TEMPLATE,
                     'language': {'code': settings.WHATSAPP_TEMPLATE_LANGUAGE},
                     'components': components},
    }
    request = Request(_url('messages'), data=json.dumps(payload).encode(), method='POST',
                      headers={'Content-Type': 'application/json'})
    _call(request)
    return number


# --------------------------------------------------------------------------- used by the app

def is_configured():
    """True when a PDF can be sent straight to a number right now."""
    return meta_configured() or bool(linked_numbers())


def send_pdf(phone, content, filename, values, account=None):
    """Send the PDF to `phone`. `values` fills the Meta template body; `values['caption']` goes with the PDF.
    `account`: the linked WhatsApp number to send from (each device picks its own); default the main one."""
    number = whatsapp_number(phone)
    if len(number) < 10:
        raise ValidationError({'detail': 'This party has no mobile number. Add it to the party first.'})
    if meta_configured():
        return _send_meta(number, content, filename, values)
    return _send_local(number, content, filename, values.get('caption') or '', account)
