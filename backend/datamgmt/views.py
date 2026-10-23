from django.conf import settings
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.exports import ZIP, file_response, safe_filename, xlsx_response
from core.permissions import OwnerOnly
from ledger import balances

from . import backup, cleanup
from .export import export_workbook


class BackupView(APIView):
    permission_classes = [OwnerOnly]

    def get(self, request):
        content, filename = backup.build_backup(request.user.business)
        return file_response(content, filename, ZIP)


def backup_status(business):
    settings_obj = business.settings
    latest = backup.latest_daily_backup(business)
    return {
        'auto_enabled': settings.AUTO_BACKUP_ENABLED,
        'keep_days': settings.AUTO_BACKUP_KEEP_DAYS,
        'last_backup': latest,
        'copy_folder': settings_obj.backup_copy_folder,
        'copy_status': settings_obj.backup_copy_status,
        'copy_message': settings_obj.backup_copy_message,
        'copy_checked_at': settings_obj.backup_copy_checked_at,
        'suggested_folder': backup.suggested_copy_folder(),
    }


class BackupStatusView(APIView):
    """Daily backup: when it last ran, where copies go and whether the last copy worked."""

    permission_classes = [OwnerOnly]

    def get(self, request):
        return Response(backup_status(request.user.business))


class BackupNowView(APIView):
    permission_classes = [OwnerOnly]

    def post(self, request):
        business = request.user.business
        backup.run_daily_backup(business, force=True)
        business.settings.refresh_from_db()
        return Response(backup_status(business))


class BackupFolderView(APIView):
    """Set (or clear) the folder that receives a copy of every daily backup."""

    permission_classes = [OwnerOnly]

    def put(self, request):
        business = request.user.business
        folder = str(request.data.get('folder') or '').strip()
        if len(folder) > 500:
            raise ValidationError({'folder': 'This folder path is too long.'})
        error = backup.check_copy_folder(folder, create=True)
        if error:
            raise ValidationError({'folder': error})
        settings_obj = business.settings
        settings_obj.backup_copy_folder = folder
        settings_obj.backup_copy_status = ''
        settings_obj.backup_copy_message = ''
        settings_obj.backup_copy_checked_at = None
        settings_obj.save()
        latest = backup.latest_daily_backup(business)
        if folder and latest:  # copy the newest backup straight away so the folder is not empty
            path, _created = backup.auto_backup_path(business, latest['name'])
            if path:
                backup.copy_backup(business, path)
                settings_obj.refresh_from_db()
        return Response(backup_status(business))


class SafetyBackupListView(APIView):
    """Backups saved on the server: daily ones and safety ones taken before restore / delete / reset."""

    permission_classes = [OwnerOnly]

    def get(self, request):
        return Response({'results': backup.list_auto_backups(request.user.business)})


class SafetyBackupFileView(APIView):
    permission_classes = [OwnerOnly]

    def get(self, request, name):
        business = request.user.business
        path, created = backup.auto_backup_path(business, name)
        if not path:
            raise NotFound('This safety backup no longer exists.')
        stamp = timezone.localtime(created).strftime('%Y-%m-%d %H%M')
        response = FileResponse(open(path, 'rb'), as_attachment=True, content_type=ZIP,
                                filename=safe_filename(f'{business.name} safety backup {stamp}', 'zip'))
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response


class SavedBackupRestoreView(APIView):
    """Restore one of the backups saved on the server (no upload needed)."""

    permission_classes = [OwnerOnly]

    def post(self, request, name):
        if request.data.get('confirm') != 'RESTORE':
            raise ValidationError({'confirm': 'Type RESTORE to confirm.'})
        counts = backup.restore_saved_backup(request.user.business, name)
        return Response({'detail': 'Backup restored successfully.', 'counts': counts})


class RestoreView(APIView):
    permission_classes = [OwnerOnly]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get('file')
        if request.data.get('confirm') != 'RESTORE':
            manifest = backup.inspect_backup(upload)
            return Response({'requires_confirmation': True, 'manifest': manifest})
        counts = backup.restore_backup(request.user.business, upload)
        return Response({'detail': 'Backup restored successfully.', 'counts': counts})


class ExportExcelView(APIView):
    permission_classes = [OwnerOnly]

    def get(self, request):
        business = request.user.business
        stamp = timezone.localtime().strftime('%Y-%m-%d')
        return xlsx_response(export_workbook(business), f'{business.name} all data {stamp}')


class CleanupPreviewView(APIView):
    permission_classes = [OwnerOnly]

    def post(self, request):
        options = cleanup.parse_options(request.data)
        plan = cleanup.build_plan(request.user.business, *options)
        return Response(cleanup.preview(request.user.business, plan))


class CleanupView(APIView):
    permission_classes = [OwnerOnly]

    def post(self, request):
        options = cleanup.parse_options(request.data)
        business = request.user.business
        plan = cleanup.build_plan(business, *options)
        expected = request.data.get('expected_total')
        current = cleanup.preview(business, plan)
        if expected is not None and str(expected) != str(current['total']):
            return Response({'detail': 'Data changed since the preview. Please review the numbers again.',
                             'errors': {}, 'preview': current}, status=409)
        if request.data.get('create_backup', True):
            backup.save_auto_backup(business, 'before-cleanup')
        result = cleanup.execute(business, plan)
        return Response({'detail': f'Deleted {result["total"]} record(s).', **result})


class ResetView(APIView):
    """Danger zone: delete all transactions, optionally all customers/items/banks too."""

    permission_classes = [OwnerOnly]

    def post(self, request):
        if request.data.get('confirm') != 'DELETE':
            raise ValidationError({'confirm': 'Type DELETE to confirm.'})
        scope = request.data.get('scope', 'transactions')
        if scope not in ('transactions', 'everything'):
            raise ValidationError({'scope': 'Unknown option.'})
        business = request.user.business
        backup.save_auto_backup(business, 'before-reset')
        with transaction.atomic():
            backup.wipe_business_data(business, include_masters=scope == 'everything')
            from banking.services import ensure_single_bank
            from transactions.services import cash_account
            cash_account(business)
            ensure_single_bank(business)
            balances.rebuild_business(business)
        return Response({'detail': 'All transactions were deleted.' if scope == 'transactions'
                         else 'All business data was deleted.'})


class RebuildView(APIView):
    permission_classes = [OwnerOnly]

    def post(self, request):
        balances.rebuild_business(request.user.business)
        return Response({'detail': 'All balances, stock and ledgers were recalculated.'})
