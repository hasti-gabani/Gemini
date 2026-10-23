"""Serve the built React single-page app for every non-API route."""
from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie

NOT_BUILT = """<!doctype html><html><head><meta charset="utf-8"><title>{app}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui;padding:32px;max-width:640px;margin:auto;line-height:1.6">
<h2>{app} API is running</h2>
<p>The web app has not been built yet. Either run the dev server
(<code>cd frontend &amp;&amp; npm run dev</code>, then open port 3100) or build it once
(<code>cd frontend &amp;&amp; npm run build</code>) and reload this page.</p>
</body></html>"""


@never_cache
@ensure_csrf_cookie
def spa_index(request, *args, **kwargs):
    index = settings.FRONTEND_DIST / 'index.html'
    if index.exists():
        return HttpResponse(index.read_bytes(), content_type='text/html; charset=utf-8')
    return HttpResponse(NOT_BUILT.format(app=settings.APP_NAME), content_type='text/html; charset=utf-8')
