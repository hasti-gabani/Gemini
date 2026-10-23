#!/usr/bin/env python3
"""
Gemini - project runner (Windows, macOS, Linux). Needs Python 3.11+ and Node.js 20+.

    python scripts/runner.py install        create backend/venv, install Python + npm packages, migrate
    python scripts/runner.py demo           create the demo business (login: demo / demo1234)
    python scripts/runner.py start          start development servers in the background
                                            (API on :8100, app with live reload on :3100)
    python scripts/runner.py stop | restart | status
    python scripts/runner.py logs [backend|frontend]
    python scripts/runner.py build          build the production web app (frontend/dist)
    python scripts/runner.py serve [--port 8100]
                                            production server in the foreground: app + API on one port
    python scripts/runner.py online-env billing.example.com
                                            write .env for serving on the internet (HTTPS, new secret key)
    python scripts/runner.py test           backend tests + bill-calculation and printer tests
    python scripts/runner.py clean          remove logs, pid files and __pycache__
"""
import os
import platform
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, 'backend')
FRONTEND = os.path.join(ROOT, 'frontend')
WHATSAPP = os.path.join(ROOT, 'whatsapp')  # sends PDFs from the owner's own WhatsApp (linked by QR)
PIDS = os.path.join(ROOT, '.pids')
LOGS = os.path.join(ROOT, '.logs')
IS_WINDOWS = platform.system() == 'Windows'
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def say(message, color=None):
    codes = {'green': '32', 'yellow': '33', 'red': '31', 'cyan': '36'}
    if color and sys.stdout.isatty() and not IS_WINDOWS:
        message = f'\033[{codes[color]}m{message}\033[0m'
    print(message, flush=True)


def venv_python():
    candidates = [os.path.join(BACKEND, 'venv', 'Scripts', 'python.exe')] if IS_WINDOWS else [
        os.path.join(BACKEND, 'venv', 'bin', 'python3'), os.path.join(BACKEND, 'venv', 'bin', 'python')]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def backend_python():
    return venv_python() or sys.executable


def npm():
    found = shutil.which('npm') or shutil.which('npm.cmd')
    if not found:
        say('Node.js / npm was not found. Install Node.js 20+ from https://nodejs.org and try again.', 'red')
        sys.exit(1)
    return found


def run(args, cwd, env=None):
    say(f'> {" ".join(os.path.basename(a) if i == 0 else a for i, a in enumerate(args))}', 'cyan')
    result = subprocess.run(args, cwd=cwd, env=env)
    if result.returncode != 0:
        say(f'Command failed with exit code {result.returncode}.', 'red')
        sys.exit(result.returncode)


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(('10.255.255.255', 1))
            return probe.getsockname()[0]
    except OSError:
        return None


# --------------------------------------------------------------------------- process helpers

CERTS = os.path.join(ROOT, '.certs')
HTTPS_PORT = 3443


def openssl():
    found = shutil.which('openssl')
    if found:
        return found
    for base in (os.environ.get('ProgramFiles', r'C:\Program Files'), os.environ.get('ProgramFiles(x86)', '')):
        for sub in (r'Git\usr\bin\openssl.exe', r'Git\mingw64\bin\openssl.exe'):
            path = os.path.join(base, sub) if base else ''
            if path and os.path.exists(path):
                return path
    return None


def ensure_certificate(ip):
    """Self-made certificate for the secure Wi-Fi address (phones need https to share files).
    Made again when this PC's Wi-Fi address changes. Returns False when it cannot be made."""
    key, cert, stamp = (os.path.join(CERTS, name) for name in ('gemini-key.pem', 'gemini-cert.pem', 'address.txt'))
    wanted = ip or ''
    if os.path.exists(cert) and os.path.exists(key) and os.path.exists(stamp) and open(stamp).read().strip() == wanted:
        return True
    tool = openssl()
    if not tool:
        say('Secure address skipped: OpenSSL was not found (it comes with Git for Windows).', 'yellow')
        return False
    os.makedirs(CERTS, exist_ok=True)
    names = 'DNS:localhost,IP:127.0.0.1' + (f',IP:{ip}' if ip else '')
    result = subprocess.run([tool, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
                             '-keyout', key, '-out', cert, '-subj', '/CN=Gemini', '-addext', f'subjectAltName={names}'],
                            capture_output=True, text=True, creationflags=NO_WINDOW)
    if result.returncode != 0:
        say('Secure address skipped: the certificate could not be made.', 'yellow')
        return False
    with open(stamp, 'w') as handle:
        handle.write(wanted)
    return True


def pid_file(name):
    return os.path.join(PIDS, f'{name}.pid')


def read_pid(name):
    try:
        with open(pid_file(name)) as handle:
            return int(handle.read().strip())
    except (OSError, ValueError):
        return None


def is_running(pid):
    if not pid:
        return False
    if IS_WINDOWS:
        out = subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/NH'], capture_output=True, text=True,
                             creationflags=NO_WINDOW).stdout or ''
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def kill_tree(pid):
    if not is_running(pid):
        return
    if IS_WINDOWS:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)], capture_output=True, creationflags=NO_WINDOW)
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except OSError:
            os.kill(pid, signal.SIGTERM)


def start_background(name, args, cwd, env=None, shell=False):
    os.makedirs(PIDS, exist_ok=True)
    os.makedirs(LOGS, exist_ok=True)
    log = open(os.path.join(LOGS, f'{name}.log'), 'a', encoding='utf-8', errors='replace')
    log.write(f'\n--- started {time.strftime("%Y-%m-%d %H:%M:%S")} ---\n')
    log.flush()
    kwargs = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WINDOWS else {'start_new_session': True}
    process = subprocess.Popen(args, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, env=env, shell=shell, **kwargs)
    with open(pid_file(name), 'w') as handle:
        handle.write(str(process.pid))
    return process.pid


# --------------------------------------------------------------------------- commands

def cmd_install(_args):
    if not venv_python():
        say('Creating Python virtual environment in backend/venv ...')
        run([sys.executable, '-m', 'venv', 'venv'], cwd=BACKEND)
    python = backend_python()
    run([python, '-m', 'pip', 'install', '--upgrade', 'pip'], cwd=BACKEND)
    run([python, '-m', 'pip', 'install', '-r', 'requirements.txt'], cwd=BACKEND)
    run([npm(), 'install'], cwd=FRONTEND)
    run([npm(), 'install', '--no-audit', '--no-fund'], cwd=WHATSAPP)
    run([python, 'manage.py', 'migrate'], cwd=BACKEND)
    say('\nInstall complete.', 'green')
    say('Next: python scripts/runner.py demo   (optional sample data)')
    say('      python scripts/runner.py start  (development)  or  serve  (production)')


def cmd_demo(args):
    run([backend_python(), 'manage.py', 'create_demo', *args], cwd=BACKEND)


def cmd_start(_args):
    env = dict(os.environ, DEBUG=os.environ.get('DEBUG', 'True'), PYTHONUNBUFFERED='1', USE_HTTPS='False')
    if is_running(read_pid('backend')):
        say(f'Backend already running (PID {read_pid("backend")}).')
    else:
        run([backend_python(), 'manage.py', 'migrate', '--noinput'], cwd=BACKEND, env=env)
        pid = start_background('backend', [backend_python(), 'manage.py', 'runserver', '0.0.0.0:8100'], BACKEND, env)
        say(f'Backend started (PID {pid}).')
    if is_running(read_pid('frontend')):
        say(f'Frontend already running (PID {read_pid("frontend")}).')
    else:
        if not os.path.isdir(os.path.join(FRONTEND, 'node_modules')):
            run([npm(), 'install'], cwd=FRONTEND)
        pid = start_background('frontend', f'"{npm()}" run dev' if IS_WINDOWS else [npm(), 'run', 'dev'], FRONTEND,
                               shell=IS_WINDOWS)
        say(f'Frontend started (PID {pid}).')
    node = shutil.which('node')
    if is_running(read_pid('whatsapp')):
        say(f'WhatsApp service already running (PID {read_pid("whatsapp")}).')
    elif node and os.path.isdir(os.path.join(WHATSAPP, 'node_modules')):
        start_background('whatsapp', [node, 'service.mjs'], WHATSAPP)
        say('WhatsApp service started (link it once in Settings -> WhatsApp).')
    ip = lan_ip()
    secure = False
    stamp = os.path.join(CERTS, 'address.txt')
    if is_running(read_pid('https')) and not (os.path.exists(stamp) and open(stamp).read().strip() == (ip or '')):
        kill_tree(read_pid('https'))  # the Wi-Fi address changed: make a new certificate for it
    if is_running(read_pid('https')):
        secure = True
    elif node and ensure_certificate(ip):
        start_background('https', [node, os.path.join('scripts', 'https-proxy.mjs')], ROOT)
        secure = True
    say('\nOpen  http://localhost:3100', 'green')
    if ip:
        say(f'Phones on the same Wi-Fi: https://{ip}:{HTTPS_PORT}' if secure else f'Phones on the same Wi-Fi: http://{ip}:3100', 'green')
        if secure:
            say('  (first time on a phone: tap Advanced -> Proceed. Sharing PDFs to WhatsApp works on this address.)')
    say('Logs: python scripts/runner.py logs   |   Stop: python scripts/runner.py stop')


def cmd_stop(_args):
    for name in ('whatsapp', 'https', 'frontend', 'backend'):
        pid = read_pid(name)
        if is_running(pid):
            kill_tree(pid)
            say(f'{name.capitalize()} stopped (PID {pid}).')
        else:
            say(f'{name.capitalize()} was not running.')
        try:
            os.remove(pid_file(name))
        except OSError:
            pass


def cmd_restart(args):
    cmd_stop(args)
    time.sleep(1)
    cmd_start(args)


def cmd_status(_args):
    ok = True
    for name, url in (('backend', 'http://localhost:8100/api/health/'), ('frontend', 'http://localhost:3100'),
                      ('https', f'https://{lan_ip() or "localhost"}:{HTTPS_PORT}'),
                      ('whatsapp', 'http://127.0.0.1:8200/status')):
        pid = read_pid(name)
        running = is_running(pid)
        ok = ok and running
        say(f'{name.capitalize():9} {"running" if running else "stopped"}  {f"PID {pid}  " if running else ""}{url if running else ""}')
    sys.exit(0 if ok else 1)


def cmd_logs(args):
    names = [args[0]] if args and args[0] in ('backend', 'frontend') else ['backend', 'frontend']
    for name in names:
        path = os.path.join(LOGS, f'{name}.log')
        say(f'=== {name} ===', 'cyan')
        if not os.path.exists(path):
            say('(no log yet)')
            continue
        with open(path, encoding='utf-8', errors='replace') as handle:
            for line in handle.readlines()[-60:]:
                print(line.rstrip())


def cmd_build(_args):
    if not os.path.isdir(os.path.join(FRONTEND, 'node_modules')):
        run([npm(), 'install'], cwd=FRONTEND)
    run([npm(), 'run', 'build'], cwd=FRONTEND)
    say('Web app built into frontend/dist.', 'green')


def frontend_build_state():
    """'missing', 'stale' (sources changed since the last build) or 'fresh'."""
    index = os.path.join(FRONTEND, 'dist', 'index.html')
    if not os.path.exists(index):
        return 'missing'
    built = os.path.getmtime(index)
    sources = [os.path.join(FRONTEND, name) for name in ('index.html', 'package.json', 'vite.config.js')]
    for folder in ('src', 'public'):
        for base, _dirs, files in os.walk(os.path.join(FRONTEND, folder)):
            sources.extend(os.path.join(base, name) for name in files)
    return 'stale' if any(os.path.getmtime(path) > built for path in sources if os.path.exists(path)) else 'fresh'


def cmd_serve(args):
    port = '8100'
    if '--port' in args:
        port = args[args.index('--port') + 1]
    state = frontend_build_state()
    if state == 'missing':
        cmd_build(args)
    elif state == 'stale':
        if shutil.which('npm') or shutil.which('npm.cmd'):
            say('The web app changed since the last build - rebuilding.', 'yellow')
            cmd_build(args)
        else:
            say('Warning: the web app changed since the last build, but Node.js is not installed to rebuild it.',
                'yellow')
    env = dict(os.environ)
    env.setdefault('DEBUG', 'False')
    ip = lan_ip()
    if 'ALLOWED_HOSTS' not in env and not os.path.exists(os.path.join(ROOT, '.env')) \
            and not os.path.exists(os.path.join(BACKEND, '.env')):
        env['ALLOWED_HOSTS'] = ','.join(h for h in ('localhost', '127.0.0.1', ip) if h)
    python = backend_python()
    run([python, 'manage.py', 'migrate', '--noinput'], cwd=BACKEND, env=env)
    run([python, 'manage.py', 'collectstatic', '--noinput'], cwd=BACKEND, env=env)
    say(f'\nGemini is running on http://localhost:{port}'
        + (f'  (phones on the same Wi-Fi: http://{ip}:{port})' if ip else ''), 'green')
    say('Press Ctrl+C to stop.')
    if IS_WINDOWS:
        server = [python, '-m', 'waitress', f'--listen=0.0.0.0:{port}', '--threads=8', 'config.wsgi:application']
    else:
        server = [python, '-m', 'gunicorn', '--bind', f'0.0.0.0:{port}', '--workers', '3', '--timeout', '120',
                  'config.wsgi:application']
    try:
        subprocess.run(server, cwd=BACKEND, env=env)
    except KeyboardInterrupt:
        say('\nStopped.')


def read_env_file(path):
    values = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as handle:
            for line in handle:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    values[key.strip()] = value.strip()
    return values


def cmd_online_env(args):
    """Write the settings for serving the app on the internet over HTTPS into .env."""
    if not args:
        say('Usage: python scripts/runner.py online-env <your-domain>   e.g. billing.example.com', 'yellow')
        sys.exit(1)
    domain = args[0].strip().lower()
    for prefix in ('https://', 'http://'):
        if domain.startswith(prefix):
            domain = domain[len(prefix):]
    domain = domain.strip('/')
    path = os.path.join(ROOT, '.env')
    values = read_env_file(path)
    values.update({
        # keep an existing key: changing it signs everyone out and breaks shared bill links
        'SECRET_KEY': values.get('SECRET_KEY') or secrets.token_urlsafe(50),
        'DEBUG': 'False',
        'USE_HTTPS': 'True',
        'ALLOWED_HOSTS': f'{domain},localhost,127.0.0.1',
        'CSRF_TRUSTED_ORIGINS': f'https://{domain}',
        'PUBLIC_BASE_URL': f'https://{domain}',
        'ALLOW_REGISTRATION': 'False',
        'USE_X_FORWARDED_FOR': 'True',
    })
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write('# Written by `python scripts/runner.py online-env`. Keep this file private: it holds the\n'
                     '# secret key. It is ignored by git. See .env.example for every option.\n')
        for key, value in values.items():
            handle.write(f'{key}={value}\n')
    say(f'Saved {path}', 'green')
    say(f'The app will answer at https://{domain} (HTTPS only). Restart it: python scripts/runner.py serve')


def cmd_test(_args):
    run([backend_python(), 'manage.py', 'test'], cwd=BACKEND)
    node = shutil.which('node')
    if node:
        run([node, 'scripts/billCalc.test.mjs'], cwd=FRONTEND)
        run([node, 'scripts/thermalPrint.test.mjs'], cwd=FRONTEND)
    say('All tests passed.', 'green')


def cmd_clean(_args):
    for path in (PIDS, LOGS):
        shutil.rmtree(path, ignore_errors=True)
    for folder, dirs, _files in os.walk(BACKEND):
        if 'venv' in folder.split(os.sep):
            continue
        for name in dirs:
            if name == '__pycache__':
                shutil.rmtree(os.path.join(folder, name), ignore_errors=True)
    say('Cleaned.')


COMMANDS = {
    'install': cmd_install, 'demo': cmd_demo, 'start': cmd_start, 'dev': cmd_start, 'stop': cmd_stop,
    'restart': cmd_restart, 'status': cmd_status, 'logs': cmd_logs, 'build': cmd_build, 'serve': cmd_serve,
    'test': cmd_test, 'clean': cmd_clean, 'online-env': cmd_online_env,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])


if __name__ == '__main__':
    main()
