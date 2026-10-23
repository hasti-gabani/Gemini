from . import scheduler

SAFE_METHODS = {'GET', 'HEAD', 'OPTIONS', 'TRACE'}
# Requests that change nothing worth a backup: signing in/out, taking or downloading backups,
# choosing the backup folder, Excel export.
NOT_DATA_CHANGES = ('/api/auth/', '/api/data/backup', '/api/data/safety-backups/', '/api/data/export')


class AutoBackupMiddleware:
    """Starts the automatic backup threads with the first request the server handles, and marks a
    business as changed after every successful save or delete, so it is backed up soon after."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        scheduler.start()
        response = self.get_response(request)
        if (request.method not in SAFE_METHODS and 200 <= response.status_code < 300
                and request.path.startswith('/api/') and not request.path.startswith(NOT_DATA_CHANGES)):
            user = getattr(request, 'user', None)
            if user is not None and user.is_authenticated:
                scheduler.mark_changed(getattr(user, 'business_id', None))
        return response
