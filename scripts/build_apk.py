"""Build the Gemini Android app (android/) into frontend/public/gemini.apk.

Uses only the Android SDK tools and the JDK that come with Android Studio (no Gradle, nothing downloaded):
aapt2 → javac → d8 → zipalign → apksigner. Phones on the same Wi-Fi download it from
http://<this PC's Wi-Fi address>:3100/gemini.apk.

    backend/venv/Scripts/python.exe scripts/build_apk.py
"""
import os
import secrets
import shutil
import socket
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'android')
BUILD = os.path.join(APP, 'build')
OUTPUT = os.path.join(ROOT, 'frontend', 'public', 'gemini.apk')
KEYSTORE = os.path.join(APP, 'gemini-release.keystore')
KEYPASS_FILE = os.path.join(APP, '.keystore-password')
IS_WINDOWS = os.name == 'nt'


def latest(folder):
    names = [n for n in os.listdir(folder) if os.path.isdir(os.path.join(folder, n))]
    if not names:
        sys.exit(f'Nothing found in {folder}')
    return os.path.join(folder, sorted(names, key=lambda n: [int(p) if p.isdigit() else p for p in n.replace('-', '.').split('.')])[-1])


def find_sdk():
    for path in (os.environ.get('ANDROID_HOME'), os.environ.get('ANDROID_SDK_ROOT'),
                 os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Android', 'Sdk')):
        if path and os.path.isdir(os.path.join(path, 'build-tools')):
            return path
    sys.exit('Android SDK not found. Install Android Studio (it installs the SDK).')


def find_jdk():
    for path in (os.environ.get('JAVA_HOME'), r'C:\Program Files\Android\Android Studio\jbr'):
        if path and os.path.exists(os.path.join(path, 'bin', 'javac.exe' if IS_WINDOWS else 'javac')):
            return path
    sys.exit('Java (JDK) not found. Install Android Studio, or set JAVA_HOME.')


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))
            return s.getsockname()[0]
    except OSError:
        return ''


def run(args, env):
    print('>', os.path.basename(args[0]), *args[1:3], '...')
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, result.stderr)
        sys.exit(f'Failed: {os.path.basename(args[0])}')
    return result


def main():
    sdk, jdk = find_sdk(), find_jdk()
    tools = latest(os.path.join(sdk, 'build-tools'))
    android_jar = os.path.join(latest(os.path.join(sdk, 'platforms')), 'android.jar')
    exe = (lambda name, ext: os.path.join(tools, name + ext)) if IS_WINDOWS else (lambda name, ext: os.path.join(tools, name))
    jbin = lambda name: os.path.join(jdk, 'bin', name + ('.exe' if IS_WINDOWS else ''))  # noqa: E731
    env = dict(os.environ, JAVA_HOME=jdk, PATH=os.path.join(jdk, 'bin') + os.pathsep + os.environ.get('PATH', ''))

    # Start clean; OneDrive can hold a folder for a moment, so leftovers are emptied rather than required gone.
    shutil.rmtree(BUILD, ignore_errors=True)
    for dirpath, _, filenames in os.walk(BUILD):
        for name in filenames:
            os.remove(os.path.join(dirpath, name))
    gen = os.path.join(BUILD, 'gen')
    classes = os.path.join(BUILD, 'classes')
    for folder in (gen, classes):
        os.makedirs(folder, exist_ok=True)

    # The address the app suggests the first time; it can be changed in the app when the Wi-Fi changes.
    defaults = os.path.join(gen, 'com', 'gemini', 'bills')
    os.makedirs(defaults, exist_ok=True)
    with open(os.path.join(defaults, 'Defaults.java'), 'w', encoding='utf-8') as handle:
        handle.write('package com.gemini.bills;\n\n/** Written by scripts/build_apk.py. */\n'
                     f'final class Defaults {{\n    static final String SERVER = "{lan_ip()}";\n\n    private Defaults() {{}}\n}}\n')

    resources = os.path.join(BUILD, 'res.zip')
    unsigned = os.path.join(BUILD, 'unsigned.apk')
    aligned = os.path.join(BUILD, 'aligned.apk')
    run([exe('aapt2', '.exe'), 'compile', '--dir', os.path.join(APP, 'res'), '-o', resources], env)
    run([exe('aapt2', '.exe'), 'link', '-o', unsigned, '-I', android_jar, '--manifest', os.path.join(APP, 'AndroidManifest.xml'),
         '--min-sdk-version', '24', '--target-sdk-version', '35', '--java', gen, resources], env)

    sources = [os.path.join(d, f) for base in (os.path.join(APP, 'src'), gen) for d, _, fs in os.walk(base) for f in fs if f.endswith('.java')]
    run([jbin('javac'), '-source', '17', '-target', '17', '-encoding', 'UTF-8', '-nowarn', '-classpath', android_jar,
         '-d', classes, *sources], env)
    class_files = [os.path.join(d, f) for d, _, fs in os.walk(classes) for f in fs if f.endswith('.class')]
    run([exe('d8', '.bat'), '--release', '--min-api', '24', '--lib', android_jar, '--output', BUILD, *class_files], env)

    with zipfile.ZipFile(unsigned, 'a', compression=zipfile.ZIP_DEFLATED) as apk:
        apk.write(os.path.join(BUILD, 'classes.dex'), 'classes.dex')
    run([exe('zipalign', '.exe'), '-f', '-p', '4', unsigned, aligned], env)

    # One signing key for all versions, so a new APK installs over the old one.
    if not os.path.exists(KEYSTORE):
        password = secrets.token_urlsafe(18)
        with open(KEYPASS_FILE, 'w') as handle:
            handle.write(password)
        run([jbin('keytool'), '-genkeypair', '-keystore', KEYSTORE, '-alias', 'gemini', '-keyalg', 'RSA', '-keysize', '2048',
             '-validity', '10000', '-storepass', password, '-keypass', password, '-dname', 'CN=Gemini, O=HARI, C=IN'], env)
    with open(KEYPASS_FILE) as handle:
        password = handle.read().strip()
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    run([exe('apksigner', '.bat'), 'sign', '--ks', KEYSTORE, '--ks-key-alias', 'gemini', '--ks-pass', f'pass:{password}',
         '--key-pass', f'pass:{password}', '--out', OUTPUT, aligned], env)
    run([exe('apksigner', '.bat'), 'verify', OUTPUT], env)
    print(f'\nBuilt {OUTPUT} ({os.path.getsize(OUTPUT) // 1024} KB)')
    ip = lan_ip()
    if ip:
        print(f'Phones on the same Wi-Fi: open http://{ip}:3100/gemini.apk to install.')


if __name__ == '__main__':
    main()
