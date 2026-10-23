"""Full business backup to a ZIP file and restore from it.

ZIP layout:
    manifest.json   app, format version, created_at, business name, record counts
    data.json       every record of the business (ids are remapped on restore)
    files/<path>    logo, item images and payment/bill attachments

Ledger entries and bank transactions are *derived* data, so they are not
stored; restore re-posts them from the documents.
"""
import io
import json
import logging
import os
import re
import shutil
import zipfile
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import models, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from accounts.models import Business, BusinessSettings
from banking.models import BankAccount, BankAdjustment
from inventory.models import Category, Item, StockAdjustment
from ledger import balances
from ledger.models import BankTransaction, LedgerEntry
from parties.models import Party, Reminder
from transactions.models import (
    Attachment, PaymentIn, PaymentOut, Purchase, PurchaseAllocation, PurchaseItem, Sale, SaleAllocation, SaleItem,
)

logger = logging.getLogger(__name__)

APP_ID = 'tallin-sales'
FORMAT_VERSION = 1
# Machine-specific settings (a folder on this PC and its last copy result) never travel in a backup.
LOCAL_SETTINGS = {'backup_copy_folder', 'backup_copy_status', 'backup_copy_message', 'backup_copy_checked_at'}

# (key, model, business filter, foreign keys -> key of referenced table)
TABLES = [
    ('categories', Category, 'business', {}),
    ('items', Item, 'business', {'category': 'categories'}),
    ('stock_adjustments', StockAdjustment, 'business', {'item': 'items'}),
    ('parties', Party, 'business', {}),
    ('reminders', Reminder, 'business', {'party': 'parties'}),
    ('bank_accounts', BankAccount, 'business', {}),
    ('bank_adjustments', BankAdjustment, 'business', {'from_account': 'bank_accounts', 'to_account': 'bank_accounts'}),
    ('sales', Sale, 'business', {'party': 'parties'}),
    ('sale_items', SaleItem, 'sale__business', {'sale': 'sales', 'item': 'items'}),
    ('purchases', Purchase, 'business', {'party': 'parties'}),
    ('purchase_items', PurchaseItem, 'purchase__business', {'purchase': 'purchases', 'item': 'items'}),
    ('payments_in', PaymentIn, 'business', {'party': 'parties', 'account': 'bank_accounts', 'origin_sale': 'sales'}),
    ('payments_out', PaymentOut, 'business',
     {'party': 'parties', 'account': 'bank_accounts', 'origin_purchase': 'purchases'}),
    ('sale_allocations', SaleAllocation, 'payment__business', {'payment': 'payments_in', 'sale': 'sales'}),
    ('purchase_allocations', PurchaseAllocation, 'payment__business',
     {'payment': 'payments_out', 'purchase': 'purchases'}),
    ('attachments', Attachment, 'business',
     {'sale': 'sales', 'purchase': 'purchases', 'payment_in': 'payments_in', 'payment_out': 'payments_out'}),
]
SKIP_FIELDS = {'business', 'created_by', 'uploaded_by'}
BUSINESS_FIELDS = ['name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'gstin']


def _encode(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _row(instance):
    data = {'id': instance.pk}
    for field in instance._meta.concrete_fields:
        if field.primary_key or field.name in SKIP_FIELDS:
            continue
        if isinstance(field, models.ForeignKey):
            data[field.name] = getattr(instance, field.attname)
        elif isinstance(field, models.FileField):
            file = getattr(instance, field.name)
            data[field.name] = file.name if file else ''
        else:
            data[field.name] = _encode(getattr(instance, field.name))
    return data


def _file_bytes(name):
    from django.core.files.storage import default_storage
    try:
        with default_storage.open(name, 'rb') as handle:
            return handle.read()
    except (FileNotFoundError, OSError):
        return None


def build_backup(business):
    """Return (zip bytes, filename)."""
    data = {'business': {field: getattr(business, field) for field in BUSINESS_FIELDS},
            'business_logo': business.logo.name if business.logo else ''}
    settings_obj = business.settings
    data['settings'] = {f.name: _encode(getattr(settings_obj, f.name)) for f in settings_obj._meta.concrete_fields
                        if f.name not in ('id', 'business', 'updated_at') and f.name not in LOCAL_SETTINGS}
    files = set()
    if business.logo:
        files.add(business.logo.name)
    counts = {}
    for key, model, business_path, _fks in TABLES:
        rows = []
        for instance in model.objects.filter(**{business_path: business}).order_by('pk').iterator(chunk_size=500):
            row = _row(instance)
            for field in instance._meta.concrete_fields:
                if isinstance(field, models.FileField) and row.get(field.name):
                    files.add(row[field.name])
            rows.append(row)
        data[key] = rows
        counts[key] = len(rows)

    created = timezone.localtime()
    manifest = {'app': APP_ID, 'format': FORMAT_VERSION, 'created_at': created.isoformat(),
                'business': business.name, 'counts': counts}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr('data.json', json.dumps(data, ensure_ascii=False))
        for name in sorted(files):
            content = _file_bytes(name)
            if content is not None:
                archive.writestr(f'files/{name}', content)
    safe_name = ''.join(ch for ch in business.name if ch.isalnum() or ch in ' -_').strip() or 'business'
    return buffer.getvalue(), f'{safe_name} backup {created.strftime("%Y-%m-%d %H%M")}.zip'


# Backups saved on the server: a daily one (kept AUTO_BACKUP_KEEP_DAYS days) and safety backups
# taken just before a restore / data delete / reset (latest AUTO_BACKUP_KEEP kept).
AUTO_BACKUP_KEEP = 5
DAILY = 'daily'
AFTER_CHANGE = 'after-change'
AUTO_BACKUP_NAME = re.compile(r'^(?P<reason>[a-z]+(?:-[a-z]+)*)-(?P<stamp>\d{8}-\d{6})\.zip$')
AUTO_BACKUP_REASONS = {
    DAILY: 'Daily automatic backup',
    AFTER_CHANGE: 'Automatic backup after changes',
    'before-restore': 'Before restoring a backup',
    'before-cleanup': 'Before deleting old data',
    'before-reset': 'Before deleting all data',
}


def _auto_backup_folder(business):
    return os.path.join(settings.MEDIA_ROOT, 'backups', f'business_{business.id}')


def _auto_backup_files(folder):
    """[(stamp, filename, reason)] newest first. Sorted by time, not by name:
    names start with the reason, so name order would prune the newest file."""
    if not os.path.isdir(folder):
        return []
    found = []
    for name in os.listdir(folder):
        match = AUTO_BACKUP_NAME.match(name)
        if match:
            found.append((match.group('stamp'), name, match.group('reason')))
    return sorted(found, reverse=True)


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def _stamp_datetime(stamp):
    return timezone.make_aware(datetime.strptime(stamp, '%Y%m%d-%H%M%S'))


def save_auto_backup(business, label):
    content, _name = build_backup(business)
    folder = _auto_backup_folder(business)
    os.makedirs(folder, exist_ok=True)
    moment = timezone.localtime()
    path = os.path.join(folder, f'{label}-{moment.strftime("%Y%m%d-%H%M%S")}.zip')
    while os.path.exists(path):  # two backups in the same second: never overwrite one
        moment += timedelta(seconds=1)
        path = os.path.join(folder, f'{label}-{moment.strftime("%Y%m%d-%H%M%S")}.zip')
    # write under a temporary name first, so a half-written file is never listed or copied
    with open(path + '.part', 'wb') as handle:
        handle.write(content)
    os.replace(path + '.part', path)
    files = _auto_backup_files(folder)
    if label == DAILY:
        cutoff = timezone.now() - timedelta(days=settings.AUTO_BACKUP_KEEP_DAYS)
        for stamp, old, reason in files:
            if reason == DAILY and _stamp_datetime(stamp) < cutoff:
                _remove(os.path.join(folder, old))
    elif label == AFTER_CHANGE:
        for _stamp, old, _reason in [f for f in files if f[2] == AFTER_CHANGE][settings.AUTO_BACKUP_CHANGE_KEEP:]:
            _remove(os.path.join(folder, old))
    else:
        for _stamp, old, _reason in [f for f in files if f[2] not in (DAILY, AFTER_CHANGE)][AUTO_BACKUP_KEEP:]:
            _remove(os.path.join(folder, old))
    return path


def list_auto_backups(business):
    folder = _auto_backup_folder(business)
    results = []
    for stamp, name, reason in _auto_backup_files(folder):
        try:
            size = os.path.getsize(os.path.join(folder, name))
        except OSError:
            continue
        created = _stamp_datetime(stamp)
        results.append({
            'name': name,
            'reason': reason,
            'reason_label': AUTO_BACKUP_REASONS.get(reason, reason.replace('-', ' ').capitalize()),
            'created_at': created.isoformat(),
            'size': size,
        })
    return results


def auto_backup_path(business, name):
    """Absolute path of a safety backup, or None. Only plain generated names are
    accepted, so a name can never point outside the business's backup folder."""
    match = AUTO_BACKUP_NAME.match(name or '')
    if not match:
        return None, None
    path = os.path.join(_auto_backup_folder(business), name)
    if not os.path.isfile(path):
        return None, None
    return path, _stamp_datetime(match.group('stamp'))


# --------------------------------------------------------------------------- daily backup + copy

COPY_NAME = re.compile(r'^gemini-backup-b(?P<business>\d+)-(?P<stamp>\d{8}-\d{6})\.zip$')


def latest_daily_backup(business):
    for entry in list_auto_backups(business):
        if entry['reason'] == DAILY:
            return entry
    return None


def daily_backup_due(business, now=None):
    latest = latest_daily_backup(business)
    if latest is None:
        return True
    today = timezone.localtime(now or timezone.now()).date()
    return timezone.localtime(datetime.fromisoformat(latest['created_at'])).date() < today


def check_copy_folder(folder, create=False):
    """Return an error message, or '' when files can be written to `folder`.
    With create=True a missing last folder (e.g. "Gemini Backups") is created when its parent exists."""
    folder = (folder or '').strip()
    if not folder:
        return ''
    if not os.path.isabs(folder):
        return 'Enter the full folder path, for example G:\\My Drive\\Gemini Backups.'
    if not os.path.isdir(folder):
        parent = os.path.dirname(os.path.normpath(folder))
        if create and parent and os.path.isdir(parent):
            try:
                os.makedirs(folder, exist_ok=True)
            except OSError as error:
                return f'Could not create the folder: {error.strerror or error}.'
        else:
            return ('Folder not found. If it is a Google Drive folder, check that Google Drive for desktop '
                    'is running and signed in.')
    probe = os.path.join(folder, '.gemini-write-test')
    try:
        with open(probe, 'w', encoding='utf-8') as handle:
            handle.write('ok')
        os.remove(probe)
    except OSError:
        return 'Cannot save files in this folder. Choose a folder you can write to.'
    return ''


def copy_backup(business, path, now=None):
    """Copy a saved backup to the folder chosen in Settings. Never raises: the result is
    stored on the settings (status + message) and shown as a warning in the app."""
    settings_obj = business.settings
    folder = (settings_obj.backup_copy_folder or '').strip()
    if not folder:
        return None
    now = now or timezone.now()
    error = check_copy_folder(folder)
    if not error:
        stamp = timezone.localtime(now).strftime('%Y%m%d-%H%M%S')
        target = os.path.join(folder, f'gemini-backup-b{business.id}-{stamp}.zip')
        try:
            shutil.copyfile(path, target + '.part')
            os.replace(target + '.part', target)
        except OSError as problem:
            error = f'Copy failed: {problem.strerror or problem}.'
            _remove(target + '.part')
        else:
            cutoff = now - timedelta(days=settings.AUTO_BACKUP_KEEP_DAYS)
            for name in os.listdir(folder):
                match = COPY_NAME.match(name)
                if match and match.group('business') == str(business.id) \
                        and _stamp_datetime(match.group('stamp')) < cutoff:
                    _remove(os.path.join(folder, name))
    settings_obj.backup_copy_status = 'error' if error else 'ok'
    settings_obj.backup_copy_message = error[:500]
    settings_obj.backup_copy_checked_at = now
    type(settings_obj).objects.filter(pk=settings_obj.pk).update(
        backup_copy_status=settings_obj.backup_copy_status, backup_copy_message=settings_obj.backup_copy_message,
        backup_copy_checked_at=now)
    if error:
        logger.warning('Backup copy for business %s failed: %s', business.id, error)
    return not error


def run_daily_backup(business, force=False):
    """Take today's backup (unless one exists) and copy it to the chosen folder."""
    if not force and not daily_backup_due(business):
        return None
    path = save_auto_backup(business, DAILY)
    copy_backup(business, path)
    return path


def suggested_copy_folder():
    """A Google Drive for desktop "My Drive" folder on this computer, if there is one."""
    candidates = []
    if os.name == 'nt':
        candidates = [f'{letter}:\\My Drive' for letter in 'GHIJKLMNOPQRSTUVWXYZDEF']
    else:
        home = os.path.expanduser('~')
        candidates = [os.path.join(home, 'Google Drive', 'My Drive'), os.path.join(home, 'My Drive'),
                      '/Volumes/GoogleDrive/My Drive']
    for base in candidates:
        try:
            if os.path.isdir(base):
                return os.path.join(base, 'Gemini Backups')
        except OSError:
            continue
    return ''


def restore_saved_backup(business, name):
    from django.core.files import File

    path, _created = auto_backup_path(business, name)
    if not path:
        raise ValidationError({'detail': 'This backup no longer exists.'})
    with open(path, 'rb') as handle:
        return restore_backup(business, File(handle, name=name))


# --------------------------------------------------------------------------- restore

def _read_archive(upload):
    max_bytes = settings.MAX_RESTORE_MB * 1024 * 1024
    if upload is None:
        raise ValidationError({'file': 'Choose a backup file (.zip).'})
    if upload.size > max_bytes:
        raise ValidationError({'file': f'Backup file is too large (max {settings.MAX_RESTORE_MB} MB).'})
    try:
        archive = zipfile.ZipFile(upload)
    except zipfile.BadZipFile:
        raise ValidationError({'file': 'This is not a valid backup file. Choose the .zip file created by Backup.'})
    total = sum(info.file_size for info in archive.infolist())
    if total > max_bytes * 4:
        raise ValidationError({'file': 'Backup file contents are too large.'})
    try:
        manifest = json.loads(archive.read('manifest.json'))
        data = json.loads(archive.read('data.json'))
    except (KeyError, ValueError):
        raise ValidationError({'file': 'This backup file is incomplete or damaged.'})
    if manifest.get('app') != APP_ID:
        raise ValidationError({'file': 'This file is not a Gemini backup.'})
    if manifest.get('format', 0) > FORMAT_VERSION:
        raise ValidationError({'file': 'This backup was made by a newer version of the app. Please update first.'})
    return archive, manifest, data


def inspect_backup(upload):
    _archive, manifest, _data = _read_archive(upload)
    return manifest


def wipe_business_data(business, include_masters=True):
    """Delete transactions (and optionally master data) of a business."""
    LedgerEntry.objects.filter(business=business).delete()
    BankTransaction.objects.filter(business=business).delete()
    for attachment in Attachment.objects.filter(business=business):
        attachment.delete()  # removes file via signal
    PaymentIn.objects.filter(business=business).delete()
    PaymentOut.objects.filter(business=business).delete()
    Sale.objects.filter(business=business).delete()
    Purchase.objects.filter(business=business).delete()
    BankAdjustment.objects.filter(business=business).delete()
    StockAdjustment.objects.filter(business=business).delete()
    if include_masters:
        Reminder.objects.filter(business=business).delete()
        Party.objects.filter(business=business).delete()
        for item in Item.objects.filter(business=business):
            item.delete()  # removes image via signal
        Category.objects.filter(business=business).delete()
        BankAccount.objects.filter(business=business).delete()


def _convert(field, value):
    if value is None:
        return None
    if isinstance(field, models.DecimalField):
        return Decimal(str(value))
    if isinstance(field, models.DateTimeField):
        parsed = datetime.fromisoformat(value)
        return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)
    if isinstance(field, models.DateField):
        return date.fromisoformat(value[:10])
    return field.to_python(value)


def _restore_file(archive, stored_name, upload_to):
    if not stored_name:
        return None
    try:
        content = archive.read(f'files/{stored_name}')
    except KeyError:
        return None
    from django.core.files.storage import default_storage
    base = os.path.basename(stored_name) or 'file'
    folder = upload_to if isinstance(upload_to, str) else ''
    folder = timezone.now().strftime(folder) if folder else ''
    return default_storage.save(os.path.join(folder, base), ContentFile(content))


@transaction.atomic
def restore_backup(business, upload):
    archive, manifest, data = _read_archive(upload)
    save_auto_backup(business, 'before-restore')
    wipe_business_data(business, include_masters=True)

    # Business profile & settings
    for field in BUSINESS_FIELDS:
        if field in data.get('business', {}):
            setattr(business, field, (data['business'][field] or '')[:Business._meta.get_field(field).max_length])
    logo_name = _restore_file(archive, data.get('business_logo'), 'business/')
    if logo_name:
        business.logo.name = logo_name  # the replaced logo file is removed once the restore commits
    business.save()
    settings_obj, _ = BusinessSettings.objects.get_or_create(business=business)
    for name, value in (data.get('settings') or {}).items():
        try:
            field = BusinessSettings._meta.get_field(name)
        except Exception:
            continue
        if field.concrete and not field.primary_key and name not in ('business', 'updated_at') \
                and name not in LOCAL_SETTINGS:
            setattr(settings_obj, name, _convert(field, value))
    settings_obj.save()

    id_maps = {}
    for key, model, _business_path, fks in TABLES:
        mapping = id_maps.setdefault(key, {})
        has_business = any(f.name == 'business' for f in model._meta.concrete_fields)
        for row in data.get(key) or []:
            kwargs = {}
            for field in model._meta.concrete_fields:
                if field.primary_key or field.name in SKIP_FIELDS or field.name not in row:
                    continue
                value = row[field.name]
                if isinstance(field, models.ForeignKey):
                    target = fks.get(field.name)
                    if target is None:
                        continue
                    new_id = id_maps.get(target, {}).get(value) if value is not None else None
                    if value is not None and new_id is None and not field.null:
                        raise ValidationError({'file': f'Backup is inconsistent ({key} → {target}).'})
                    kwargs[field.attname] = new_id
                elif isinstance(field, models.FileField):
                    restored = _restore_file(archive, value, field.upload_to)
                    kwargs[field.name] = restored or ''
                else:
                    kwargs[field.name] = _convert(field, value)
            if has_business:
                kwargs['business'] = business
            instance = model(**kwargs)
            auto_now_fields = [f for f in model._meta.concrete_fields if getattr(f, 'auto_now_add', False)
                               or getattr(f, 'auto_now', False)]
            instance.save()
            if auto_now_fields:
                values = {f.name: kwargs[f.name] for f in auto_now_fields if kwargs.get(f.name)}
                if values:
                    model.objects.filter(pk=instance.pk).update(**values)
            mapping[row['id']] = instance.pk

    if not BankAccount.objects.filter(business=business, kind=BankAccount.KIND_CASH).exists():
        BankAccount.objects.create(business=business, kind=BankAccount.KIND_CASH, name='Cash in Hand')
    from banking.services import ensure_single_bank
    ensure_single_bank(business)  # a backup may hold no bank or several; keep exactly one, B
    from banking.services import move_cash_to_bank
    move_cash_to_bank(business)
    balances.rebuild_business(business)
    return {key: len(data.get(key) or []) for key, *_ in TABLES}
