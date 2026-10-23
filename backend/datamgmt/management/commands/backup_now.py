from django.core.management.base import BaseCommand

from datamgmt.scheduler import run_due_backups


class Command(BaseCommand):
    help = ("Take today's automatic backup of every business (skipped if it already exists, "
            'unless --force). Useful with Windows Task Scheduler or cron when the app is not running.')

    def add_arguments(self, parser):
        parser.add_argument('--force', action='store_true', help='Back up even if today\'s backup exists.')

    def handle(self, *args, **options):
        written = run_due_backups(force=options['force'])
        if not written:
            self.stdout.write("Nothing to do: today's backups already exist (or another backup is running).")
        for path in written:
            self.stdout.write(self.style.SUCCESS(f'Saved {path}'))
