"""Automatic backups while the app is running.

Daily: a background thread checks every AUTO_BACKUP_CHECK_MINUTES whether today's backup of each
business exists and takes it if not.

After changes: every successful save or delete marks its business as changed (see the
middleware). A second thread backs a changed business up once it has been quiet for
AUTO_BACKUP_AFTER_CHANGE_SECONDS, or AUTO_BACKUP_CHANGE_MAX_WAIT_SECONDS after the first change
at the latest, so a busy day still gets regular backups and a burst of edits makes only one.

Both threads start with the first web request (so management commands never start them), and a
lock file stops two backups being written at once.
"""
import logging
import os
import threading
import time

from django.conf import settings
from django.db import close_old_connections

logger = logging.getLogger(__name__)

_started = False
_start_lock = threading.Lock()
STARTUP_DELAY_SECONDS = 60
STALE_LOCK_SECONDS = 2 * 60 * 60
CHANGE_CHECK_SECONDS = 20

# business id -> (time of the first change not yet backed up, time of the latest change)
_changes = {}
_changes_lock = threading.Lock()


def start():
    global _started
    if _started or not settings.AUTO_BACKUP_ENABLED:
        return
    with _start_lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, name='gemini-daily-backup', daemon=True).start()
    threading.Thread(target=_change_loop, name='gemini-change-backup', daemon=True).start()


def _loop():
    time.sleep(STARTUP_DELAY_SECONDS)  # let the server finish starting first
    while True:
        try:
            run_due_backups()
        except Exception:  # keep the thread alive; the next check tries again
            logger.exception('Automatic backup failed')
        time.sleep(max(1, settings.AUTO_BACKUP_CHECK_MINUTES) * 60)


def _change_loop():
    while True:
        time.sleep(CHANGE_CHECK_SECONDS)
        try:
            run_change_backups()
        except Exception:
            logger.exception('Backup after changes failed')


def mark_changed(business_id, now=None):
    """Remember that this business's data changed, so it is backed up a little later."""
    if not business_id:
        return
    now = time.time() if now is None else now
    with _changes_lock:
        first, _last = _changes.get(business_id, (now, now))
        _changes[business_id] = (first, now)


def pending_changes():
    with _changes_lock:
        return dict(_changes)


def run_change_backups(now=None):
    """Back up every changed business that is due. Returns the files written."""
    from accounts.models import Business

    from .backup import AFTER_CHANGE, save_auto_backup

    now = time.time() if now is None else now
    quiet = max(0, settings.AUTO_BACKUP_AFTER_CHANGE_SECONDS)
    max_wait = max(quiet, settings.AUTO_BACKUP_CHANGE_MAX_WAIT_SECONDS)
    with _changes_lock:
        due = [business_id for business_id, (first, last) in _changes.items()
               if now - last >= quiet or now - first >= max_wait]
    if not due:
        return []
    lock = _acquire_lock()
    if lock is None:
        return []  # another backup is being written; try again on the next check
    written = []
    close_old_connections()
    try:
        for business_id in due:
            with _changes_lock:
                entry = _changes.pop(business_id, None)  # changes from now on wait for the next backup
            business = Business.objects.filter(pk=business_id).first()
            if business is None:
                continue
            try:
                written.append(save_auto_backup(business, AFTER_CHANGE))
                logger.info('Backup after changes saved for business %s', business_id)
            except Exception:
                logger.exception('Backup after changes of business %s failed', business_id)
                if entry:
                    with _changes_lock:
                        first, last = _changes.get(business_id, entry)
                        _changes[business_id] = (min(first, entry[0]), max(last, entry[1]))
    finally:
        close_old_connections()
        try:
            os.remove(lock)
        except OSError:
            pass
    return written


def _lock_path():
    folder = os.path.join(settings.MEDIA_ROOT, 'backups')
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, '.daily-backup.lock')


def _acquire_lock():
    path = _lock_path()
    try:
        if time.time() - os.path.getmtime(path) > STALE_LOCK_SECONDS:
            os.remove(path)  # left behind by a process that stopped mid-backup
    except OSError:
        pass
    try:
        handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return None
    os.write(handle, str(os.getpid()).encode())
    os.close(handle)
    return path


def run_due_backups(force=False):
    """Back up every business whose backup for today is missing. Returns the files written."""
    from accounts.models import Business

    from .backup import run_daily_backup

    lock = _acquire_lock()
    if lock is None:
        return []
    written = []
    close_old_connections()
    try:
        for business in Business.objects.select_related('settings').all():
            try:
                path = run_daily_backup(business, force=force)
            except Exception:
                logger.exception('Automatic backup of business %s failed', business.id)
                continue
            if path:
                written.append(path)
                logger.info('Daily backup saved: %s', path)
    finally:
        close_old_connections()
        try:
            os.remove(lock)
        except OSError:
            pass
    return written
