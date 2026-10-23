"""Send a bill / receipt PDF to a party's number through WhatsApp Desktop on this PC (Windows).

No Meta account is needed: WhatsApp Desktop, logged in on the PC that runs Gemini, opens the chat
with the party's number, the PDF is pasted and sent (core/whatsapp_desktop.ps1). The PC must be on
and unlocked; for a few seconds WhatsApp comes to the front. Turn it off with WHATSAPP_DESKTOP=False.
"""
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from django.conf import settings
from rest_framework.exceptions import ValidationError

from parties.reminders import whatsapp_number

SCRIPT = Path(__file__).with_name('whatsapp_desktop.ps1')
OUT_DIR = Path(tempfile.gettempdir()) / 'gemini-whatsapp'
KEEP_SECONDS = 24 * 60 * 60
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
_one_at_a_time = threading.Lock()  # one WhatsApp window, so sends never overlap

ERRORS = {
    2: 'WhatsApp Desktop did not open on the computer. Check that it is logged in and the computer is unlocked.',
    3: 'Another window came to the front on the computer, so the PDF was not sent. Try again without using the '
       'computer for a few seconds.',
}


def is_available():
    """WhatsApp Desktop is installed on this Windows PC (its whatsapp:// link is registered)."""
    if not settings.WHATSAPP_DESKTOP or sys.platform != 'win32':
        return False
    import winreg
    try:
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, 'whatsapp'))
        return True
    except OSError:
        return False


def _remove_old_files():
    cutoff = time.time() - KEEP_SECONDS
    for path in OUT_DIR.glob('*.pdf'):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


def send_pdf(phone, content, filename):
    """Send the PDF to `phone` from this PC's WhatsApp Desktop. Returns the number it went to."""
    number = whatsapp_number(phone)
    if len(number) < 10:
        raise ValidationError({'detail': 'This party has no mobile number. Add it to the party first.'})
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    _remove_old_files()
    path = OUT_DIR / filename
    path.write_bytes(content)  # WhatsApp reads the file while sending, so it stays for a day
    with _one_at_a_time:
        try:
            result = subprocess.run(
                ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA',
                 '-File', str(SCRIPT), '-Pdf', str(path), '-Phone', number],
                capture_output=True, text=True, timeout=60, creationflags=NO_WINDOW)
        except subprocess.TimeoutExpired:
            raise ValidationError({'detail': 'WhatsApp Desktop took too long. Check the computer and try again.'}) from None
    if result.returncode != 0:
        raise ValidationError({'detail': ERRORS.get(result.returncode, 'Could not send the PDF from WhatsApp Desktop.')})
    return number
