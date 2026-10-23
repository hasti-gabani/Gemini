"""Daily automatic backup: once a day, kept 30 days, copied to a chosen folder, restorable."""
import os
import shutil
import tempfile
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.services import bootstrap_business
from datamgmt import backup
from datamgmt import scheduler
from datamgmt.scheduler import run_due_backups
from parties.models import Party

MEDIA = tempfile.mkdtemp(prefix='ts-backup-media-')


@override_settings(MEDIA_ROOT=MEDIA, AUTO_BACKUP_KEEP_DAYS=30, AUTO_BACKUP_AFTER_CHANGE_SECONDS=120,
                   AUTO_BACKUP_CHANGE_MAX_WAIT_SECONDS=600, AUTO_BACKUP_CHANGE_KEEP=3)
class DailyBackupTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        shutil.rmtree(os.path.join(MEDIA, 'backups'), ignore_errors=True)
        self.business = bootstrap_business('Hari Traders')
        self.owner = User.objects.create_user(username='owner', password='right-pass-123', business=self.business)
        self.client = APIClient()
        self.client.force_login(self.owner)
        self.copies = tempfile.mkdtemp(prefix='ts-drive-')
        self.addCleanup(shutil.rmtree, self.copies, True)
        self.client.post('/api/parties/', {'name': 'Ghanshyambhai Nana', 'opening_balance': '2500'}, format='json')

    def folder(self):
        return backup._auto_backup_folder(self.business)

    def change_backups(self):
        return [e for e in backup.list_auto_backups(self.business) if e['reason'] == backup.AFTER_CHANGE]

    def test_saving_data_marks_it_for_a_backup_after_changes(self):
        scheduler._changes.clear()
        self.addCleanup(scheduler._changes.clear)
        self.client.get('/api/parties/')
        self.client.post('/api/auth/logout/')  # signing out is not a data change
        self.assertEqual(scheduler.pending_changes(), {})
        self.client.force_login(self.owner)
        r = self.client.post('/api/parties/', {'name': 'Kirtan Electricals'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertIn(self.business.id, scheduler.pending_changes())
        self.client.post('/api/parties/', {'name': ''}, format='json')  # a failed save changes nothing
        self.assertEqual(len(scheduler.pending_changes()), 1)

    def test_backup_after_changes_waits_for_a_quiet_moment(self):
        scheduler._changes.clear()
        self.addCleanup(scheduler._changes.clear)
        scheduler.mark_changed(self.business.id, now=1000)
        scheduler.mark_changed(self.business.id, now=1100)
        self.assertEqual(scheduler.run_change_backups(now=1150), [])  # still busy: 50 s since the last change
        written = scheduler.run_change_backups(now=1220)  # quiet for 2 minutes
        self.assertEqual(len(written), 1)
        self.assertEqual(self.change_backups()[0]['reason_label'], 'Automatic backup after changes')
        self.assertEqual(scheduler.run_change_backups(now=5000), [])  # nothing new since
        # Edits that never stop still get a backup 10 minutes after the first one.
        for moment in range(6000, 6601, 60):
            scheduler.mark_changed(self.business.id, now=moment)
        self.assertEqual(len(scheduler.run_change_backups(now=6600)), 1)

    def test_only_the_newest_backups_after_changes_are_kept(self):
        scheduler._changes.clear()
        self.addCleanup(scheduler._changes.clear)
        backup.run_daily_backup(self.business)
        for _ in range(5):
            backup.save_auto_backup(self.business, backup.AFTER_CHANGE)
        self.assertEqual(len(self.change_backups()), 3)  # AUTO_BACKUP_CHANGE_KEEP
        self.assertTrue(backup.latest_daily_backup(self.business))  # the daily one is never pruned by them

    def test_one_backup_per_day_and_thirty_days_kept(self):
        first = backup.run_daily_backup(self.business)
        self.assertTrue(first and os.path.exists(first))
        self.assertIsNone(backup.run_daily_backup(self.business))  # already done today
        # An old daily backup is removed when the next one is saved; safety backups are untouched.
        old_stamp = (timezone.localtime() - timedelta(days=31)).strftime('%Y%m%d-%H%M%S')
        recent_stamp = (timezone.localtime() - timedelta(days=29)).strftime('%Y%m%d-%H%M%S')
        for name in (f'daily-{old_stamp}.zip', f'daily-{recent_stamp}.zip', f'before-reset-{old_stamp}.zip'):
            with open(os.path.join(self.folder(), name), 'wb') as handle:
                handle.write(b'old')
        backup.run_daily_backup(self.business, force=True)
        names = os.listdir(self.folder())
        self.assertNotIn(f'daily-{old_stamp}.zip', names)
        self.assertIn(f'daily-{recent_stamp}.zip', names)
        self.assertIn(f'before-reset-{old_stamp}.zip', names)
        status = self.client.get('/api/data/backup-status/').data
        self.assertEqual(status['keep_days'], 30)
        self.assertEqual(status['last_backup']['reason'], 'daily')

    def test_scheduler_backs_up_every_business_once(self):
        other = bootstrap_business('Other Co')
        written = run_due_backups()
        self.assertEqual(len(written), 2)
        self.assertEqual(run_due_backups(), [])
        self.assertTrue(backup.latest_daily_backup(other))

    def test_copy_to_chosen_folder_and_warning_when_missing(self):
        target = os.path.join(self.copies, 'Gemini Backups')  # created on save: its parent exists
        r = self.client.put('/api/data/backup-folder/', {'folder': target}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        status = self.client.post('/api/data/backup-now/').data
        self.assertEqual(status['copy_status'], 'ok')
        copies = [n for n in os.listdir(target) if n.startswith(f'gemini-backup-b{self.business.id}-')]
        self.assertEqual(len(copies), 1)
        r = self.client.put('/api/data/backup-folder/', {'folder': os.path.join(self.copies, 'x', 'y')},
                            format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('Folder not found', r.data['errors']['folder'])
        # The folder disappears (e.g. Google Drive not running): the backup is still saved, with a warning.
        shutil.rmtree(target)
        before = len(os.listdir(self.folder()))
        status = self.client.post('/api/data/backup-now/').data
        self.assertEqual(len(os.listdir(self.folder())), before + 1)
        self.assertEqual(status['copy_status'], 'error')
        self.assertIn('Google Drive', status['copy_message'])
        self.assertEqual(self.client.put('/api/data/backup-folder/', {'folder': ''}, format='json').status_code, 200)

    def test_restore_a_saved_backup(self):
        backup.run_daily_backup(self.business)
        name = backup.latest_daily_backup(self.business)['name']
        Party.objects.filter(business=self.business).delete()
        self.assertEqual(self.client.post(f'/api/data/safety-backups/{name}/restore/', {}, format='json').status_code,
                         400)  # needs the typed confirmation
        r = self.client.post(f'/api/data/safety-backups/{name}/restore/', {'confirm': 'RESTORE'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        party = Party.objects.get(business=self.business)
        self.assertEqual((party.name, str(party.balance)), ('Ghanshyambhai Nana', '2500.00'))

    def test_backups_are_for_the_owner_only(self):
        staff = User.objects.create_user(username='staff', password='staff-pass-123', business=self.business,
                                         role=User.ROLE_STAFF)
        client = APIClient()
        client.force_login(staff)
        backup.run_daily_backup(self.business)
        name = backup.latest_daily_backup(self.business)['name']
        for url in ('/api/data/backup-status/', '/api/data/safety-backups/', f'/api/data/safety-backups/{name}/',
                    '/api/data/backup/'):
            self.assertEqual(client.get(url).status_code, 403, url)
        self.assertEqual(APIClient().get(f'/api/data/safety-backups/{name}/').status_code, 403)
