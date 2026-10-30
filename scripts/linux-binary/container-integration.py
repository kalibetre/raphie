import json, os, pathlib, pty, re, select, shutil, subprocess, time, urllib.request

if os.environ.get('RAPHIE_DISPOSABLE_TEST') != '1' or not pathlib.Path('/.dockerenv').exists():
    raise SystemExit('Run only in a fresh disposable container with RAPHIE_DISPOSABLE_TEST=1.')
if any(pathlib.Path(p).exists() for p in ('/etc/raphie', '/opt/raphie', '/var/lib/raphie', '/usr/local/bin/raphie', '/srv/raphie-test-data')):
    raise SystemExit('Refusing to overwrite an existing installation or test directory.')

stub = pathlib.Path('/tmp/raphie-test-stubs')
stub.mkdir()
(stub / 'systemd-creds').write_text('#!/bin/sh\nfor last; do :; done\ncat > "$last"\n')
(stub / 'systemctl').write_text('''#!/bin/sh
set -eu
case "$1" in
  daemon-reload) exit 0;;
  enable|start)
    set -a; . /etc/raphie/raphie.conf; set +a
    export HOME=/var/lib/raphie
    setsid runuser -u raphie -- env HOME="$HOME" DATA_DIRECTORY="$DATA_DIRECTORY" RAPHIE_WEB_ORIGIN="$RAPHIE_WEB_ORIGIN" RAPHIE_WEB_PORT="$RAPHIE_WEB_PORT" dbus-run-session -- sh -c 'printf "synthetic-only\\n" | gnome-keyring-daemon --unlock >/dev/null; exec /opt/raphie/current/raphie start' >/tmp/raphie-service-test.log 2>&1 &
    echo $! >/tmp/raphie-service-test.pid;;
  is-active) kill -0 "$(cat /tmp/raphie-service-test.pid)";;
  stop) python3 -c 'import os,signal,time; p=int(open("/tmp/raphie-service-test.pid").read()); os.killpg(p,signal.SIGTERM); time.sleep(1)' || true;;
  *) exit 1;;
esac
''')
for path in stub.iterdir(): path.chmod(0o755)
env = dict(os.environ, PATH=str(stub) + ':' + os.environ['PATH'])
for args in (['--data-dir', 'relative'], ['--web-origin', 'https://example.com/path'], ['--data-dir', '/'], ['--data-dir', '/var/lib/raphie/.local/share/keyrings'], ['--web-origin', 'http://example.com'], ['--web-origin', 'https://example.com']):
    result = subprocess.run(['sh', '/binaries/install.sh', *args], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert result.returncode != 0 and not pathlib.Path('/etc/raphie').exists()

def interactive(command, prompts):
    master, slave = pty.openpty()
    proc = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, env=env)
    os.close(slave)
    data = b''
    pending = list(prompts)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.25)
        if ready:
            try: chunk = os.read(master, 8192)
            except OSError: break
            if not chunk: break
            data += chunk
            if pending and pending[0][0] in data:
                _, answer = pending.pop(0)
                os.write(master, answer + b'\n')
        if proc.poll() is not None: break
    if proc.poll() is None: proc.kill()
    code = proc.wait()
    os.close(master)
    if code or pending: raise RuntimeError('Interactive command failed or did not complete expected prompts')
    return data

subprocess.run(['sh', '/binaries/install.sh', '--data-dir', '/srv/raphie-test-data', '--web-origin', 'http://localhost:4320'], check=True, env=env, stdout=subprocess.DEVNULL)
subprocess.run(['/usr/local/bin/raphie', 'health'], check=True, env=env)
def auth_status(): return json.load(urllib.request.urlopen('http://127.0.0.1:4320/auth/status'))
assert auth_status() == {'configured': False, 'authenticated': False}
password = b'a long synthetic password'
interactive(['/usr/local/bin/raphie', 'auth', 'setup'], [(b'Administrator email:', b'admin@example.test'), (b'New password', password), (b'Repeat password', password)])
assert auth_status() == {'configured': True, 'authenticated': False}
secret = pathlib.Path('/srv/raphie-test-data/auth.secret')
assert oct(secret.stat().st_mode & 0o777) == '0o600' and pathlib.Path('/srv/raphie-test-data/auth.sqlite').stat().st_uid == secret.stat().st_uid != 0
data_dir = pathlib.Path('/srv/raphie-test-data')
marker = data_dir / 'restore-test-marker'
marker.write_text('before update')
shutil.copytree('/binaries', '/tmp/raphie-new-bundle')
with open('/tmp/raphie-new-bundle/raphie.service', 'a') as service: service.write('\n# synthetic second bundle\n')
old_release = os.readlink('/opt/raphie/current')
subprocess.run(['/usr/local/bin/raphie', 'update', '/tmp/raphie-new-bundle'], check=True, env=env, stdout=subprocess.DEVNULL)
assert os.readlink('/opt/raphie/current') != old_release and marker.read_text() == 'before update'
marker.write_text('after update')
backups = list(pathlib.Path('/var/backups/raphie').glob('raphie-*.tar'))
assert len(backups) == 1
interactive(['/usr/local/bin/raphie', 'restore', str(backups[0])], [(b'Type RESTORE to continue:', b'RESTORE')])
assert os.readlink('/opt/raphie/current') == old_release and marker.read_text() == 'before update'
subprocess.run(['/usr/local/bin/raphie', 'health'], check=True, env=env)
assert auth_status()['configured'] is True
shutil.copytree('/binaries', '/tmp/raphie-bad-bundle')
pathlib.Path('/tmp/raphie-bad-bundle/raphie-web').write_text('#!/bin/sh\nexit 1\n')
pathlib.Path('/tmp/raphie-bad-bundle/raphie-web').chmod(0o755)
failed = subprocess.run(['/usr/local/bin/raphie', 'update', '/tmp/raphie-bad-bundle'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
assert failed.returncode != 0
failed_backups = set(pathlib.Path('/var/backups/raphie').glob('raphie-*.tar')) - set(backups)
assert len(failed_backups) == 1
interactive(['/usr/local/bin/raphie', 'restore', str(failed_backups.pop())], [(b'Type RESTORE to continue:', b'RESTORE')])
assert os.readlink('/opt/raphie/current') == old_release and marker.read_text() == 'before update'
subprocess.run(['/usr/local/bin/raphie', 'health'], check=True, env=env)
assert auth_status()['configured'] is True
print('Binary installation, overrides, update and backup restore passed (systemd simulated).')
subprocess.run(['systemctl', 'stop', 'raphie.service'], check=True, env=env)
