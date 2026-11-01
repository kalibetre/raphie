import json, os, pathlib, pty, re, select, shutil, socket, subprocess, tarfile, time, urllib.request

if os.environ.get('RAPHIE_DISPOSABLE_TEST') != '1' or not pathlib.Path('/.dockerenv').exists():
    raise SystemExit('Run only in a fresh disposable container with RAPHIE_DISPOSABLE_TEST=1.')
if any(pathlib.Path(p).exists() for p in ('/etc/raphie', '/opt/raphie', '/var/lib/raphie', '/usr/local/bin/raphie', '/srv/raphie-test-data')):
    raise SystemExit('Refusing to overwrite an existing installation or test directory.')

stub = pathlib.Path('/tmp/raphie-test-stubs')
stub.mkdir()
(stub / 'systemd-creds').write_text('''#!/bin/sh
case "$1" in
  decrypt) for arg; do case "$arg" in /etc/*) input=$arg;; esac; done; cat "$input";;
  encrypt) for last; do :; done; if [ "$last" = - ]; then cat; else cat > "$last"; fi;;
  *) exit 1;;
esac
''')
(stub / 'systemctl').write_text('''#!/bin/sh
set -eu
case "$1" in
  daemon-reload) exit 0;;
  enable|start)
    set -a; . /etc/raphie/raphie.conf; set +a
    export HOME=/var/lib/raphie
    setsid runuser -u raphie -- env HOME="$HOME" DATA_DIRECTORY="$DATA_DIRECTORY" RAPHIE_WEB_ORIGIN="$RAPHIE_WEB_ORIGIN" RAPHIE_WEB_PORT="$RAPHIE_WEB_PORT" dbus-run-session -- sh -c 'printf "synthetic-only\\n" | gnome-keyring-daemon --unlock >/dev/null; exec /opt/raphie/current/raphie start' >/tmp/raphie-service-test.log 2>&1 &
    echo $! >/tmp/raphie-service-test.pid;;
  restart) "$0" stop; "$0" start;;
  is-active) kill -0 "$(cat /tmp/raphie-service-test.pid)";;
  stop|disable) python3 -c 'import os,signal,time; p=int(open("/tmp/raphie-service-test.pid").read()); os.killpg(p,signal.SIGTERM); time.sleep(1)' || true;;
  *) exit 1;;
esac
''')
for path in stub.iterdir(): path.chmod(0o755)
env = dict(os.environ, PATH=str(stub) + ':' + os.environ['PATH'])
for args in (['--data-dir', 'relative'], ['--web-origin', 'https://example.com/path'], ['--data-dir', '/'], ['--data-dir', '/var/lib/raphie/.local/share/keyrings'], ['--web-origin', 'http://example.com'], ['--web-origin', 'http://localhost:4320'], ['--web-port', '4316'], ['--web-port', '0'], ['--web-port', '65536']):
    result = subprocess.run(['sh', '/binaries/install.sh', *args], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert result.returncode != 0 and not pathlib.Path('/etc/raphie').exists()

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
    occupied.bind(('127.0.0.1', 0))
    occupied.listen()
    rejected = subprocess.run(['sh', '/binaries/install.sh', '--web-port', str(occupied.getsockname()[1])], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert rejected.returncode != 0 and not pathlib.Path('/etc/raphie').exists()

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

subprocess.run(['sh', '/binaries/install.sh', '--data-dir', '/srv/raphie-test-data', '--web-port', '41838', '--web-origin', 'http://localhost:41838'], check=True, env=env, stdout=subprocess.DEVNULL)
help_text = subprocess.check_output(['/usr/local/bin/raphie', '--help'], env=env, text=True)
assert all(command in help_text for command in ('auth setup', 'auth recover', 'health', 'update', 'restore', 'uninstall', '--purge'))
assert 'confirmation' in subprocess.check_output(['/usr/local/bin/raphie', 'uninstall', '--help'], env=env, text=True)
subprocess.run(['/usr/local/bin/raphie', 'health'], check=True, env=env)
assert subprocess.check_output(['/usr/local/bin/raphie', 'port'], env=env, text=True).strip() == '41838'
subprocess.run(['/usr/local/bin/raphie', 'set-port', '41839'], check=True, env=env, stdout=subprocess.DEVNULL)
assert subprocess.check_output(['/usr/local/bin/raphie', 'port'], env=env, text=True).strip() == '41839'
def auth_status(): return json.load(urllib.request.urlopen('http://127.0.0.1:41839/auth/status'))
assert auth_status() == {'configured': False, 'authenticated': False}
password = b'a long synthetic password'
interactive(['/usr/local/bin/raphie', 'auth', 'setup'], [(b'Administrator email:', b'admin@example.test'), (b'New password', password), (b'Repeat password', password)])
assert auth_status() == {'configured': True, 'authenticated': False}
subprocess.run(['age-keygen', '-o', '/tmp/raphie-test-identity'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
recipient = subprocess.check_output(['age-keygen', '-y', '/tmp/raphie-test-identity'], text=True).strip()
subprocess.run(['/usr/local/bin/raphie', 'recovery-key', 'export', recipient, '/tmp/raphie-recovery-key.age'], check=True, env=env, stdout=subprocess.DEVNULL)
assert oct(pathlib.Path('/tmp/raphie-recovery-key.age').stat().st_mode & 0o777) == '0o600'
subprocess.run(['age-keygen', '-o', '/tmp/raphie-wrong-identity'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
secret = pathlib.Path('/srv/raphie-test-data/auth.secret')
assert oct(secret.stat().st_mode & 0o777) == '0o600' and pathlib.Path('/srv/raphie-test-data/auth.sqlite').stat().st_uid == secret.stat().st_uid != 0
data_dir = pathlib.Path('/srv/raphie-test-data')
marker = data_dir / 'restore-test-marker'
marker.write_text('before update')
shutil.copytree('/binaries', '/tmp/raphie-new-bundle')
with open('/tmp/raphie-new-bundle/raphie.service', 'a') as service: service.write('\n# synthetic second bundle\n')
pathlib.Path('/tmp/raphie-new-bundle/future-helper.py').write_text('# synthetic future release file\n')
old_release = os.readlink('/opt/raphie/current')
subprocess.run(['/usr/local/bin/raphie', 'update', '/tmp/raphie-new-bundle'], check=True, env=env, stdout=subprocess.DEVNULL)
assert os.readlink('/opt/raphie/current') != old_release and marker.read_text() == 'before update'
assert pathlib.Path('/opt/raphie/current/future-helper.py').is_file()
marker.write_text('after update')
backups = list(pathlib.Path('/var/backups/raphie').glob('raphie-*.tar'))
assert len(backups) == 1
wrong = subprocess.run(['/usr/local/bin/raphie', 'restore', str(backups[0]), '--recovery-key', '/tmp/raphie-recovery-key.age', '--identity', '/tmp/raphie-wrong-identity'], input=b'RESTORE\n', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
assert wrong.returncode != 0 and auth_status()['configured'] is True
interactive(['/usr/local/bin/raphie', 'restore', str(backups[0]), '--recovery-key', '/tmp/raphie-recovery-key.age', '--identity', '/tmp/raphie-test-identity'], [(b'Type RESTORE to continue:', b'RESTORE')])
assert os.readlink('/opt/raphie/current') == old_release and marker.read_text() == 'before update'
subprocess.run(['/usr/local/bin/raphie', 'health'], check=True, env=env)
assert auth_status()['configured'] is True
malicious = pathlib.Path('/var/backups/raphie/raphie-malicious.tar')
with tarfile.open(malicious, 'w') as archive:
    directory = tarfile.TarInfo('data'); directory.type = tarfile.DIRTYPE; directory.mode = 0o700; archive.addfile(directory)
    link = tarfile.TarInfo('.local'); link.type = tarfile.SYMTYPE; link.linkname = '/var/lib/raphie/.local'; archive.addfile(link)
pathlib.Path(str(malicious) + '.release').write_text(pathlib.Path(str(backups[0]) + '.release').read_text())
unsafe_restore = subprocess.run(['/usr/local/bin/raphie', 'restore', str(malicious)], input=b'RESTORE\n', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
assert unsafe_restore.returncode != 0 and marker.read_text() == 'before update' and pathlib.Path('/var/lib/raphie/.local/share/keyrings').is_dir()
subprocess.run(['systemctl', 'start', 'raphie.service'], check=True, env=env)
for _ in range(30):
    if subprocess.run(['/usr/local/bin/raphie', 'health'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0: break
    time.sleep(1)
else: raise RuntimeError('Service did not recover after rejected restore')
malicious.unlink(); pathlib.Path(str(malicious) + '.release').unlink()
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
cancelled = subprocess.run(['/usr/local/bin/raphie', 'uninstall'], input=b'no\n', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
assert cancelled.returncode != 0 and pathlib.Path('/usr/local/bin/raphie').exists()
config = pathlib.Path('/etc/raphie/raphie.conf')
original = config.read_text()
config.write_text(original.replace('/srv/raphie-test-data', '/opt/raphie'))
unsafe_default = subprocess.run(['/usr/local/bin/raphie', 'uninstall'], input=b'UNINSTALL\n', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
assert unsafe_default.returncode != 0 and pathlib.Path('/usr/local/bin/raphie').exists()
pathlib.Path('/tmp/raphie-data-symlink').symlink_to('/srv/raphie-test-data')
for unsafe_path in ('/srv', '/var/lib/raphie', '/tmp/raphie-data-symlink'):
    config.write_text(original.replace('/srv/raphie-test-data', unsafe_path))
    unsafe = subprocess.run(['/usr/local/bin/raphie', 'uninstall', '--purge'], input=b'PURGE\n', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert unsafe.returncode != 0 and pathlib.Path('/usr/local/bin/raphie').exists()
config.write_text(original)
host_key = pathlib.Path('/var/lib/systemd/credential.secret')
host_key.parent.mkdir(parents=True, exist_ok=True)
host_key.write_text('shared host credential marker')
interactive(['/usr/local/bin/raphie', 'uninstall', '--purge'], [(b'Type PURGE to continue:', b'PURGE')])
assert all(not pathlib.Path(p).exists() for p in ('/etc/raphie', '/opt/raphie', '/var/lib/raphie', '/usr/local/bin/raphie', '/srv/raphie-test-data', '/var/backups/raphie'))
assert subprocess.run(['id', 'raphie'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0
assert host_key.read_text() == 'shared host credential marker'
# Exercise a public alpha bootstrap without GitHub CLI or external downloads.
alpha_archive = pathlib.Path('/tmp/raphie-public-alpha.tar.gz')
with tarfile.open(alpha_archive, 'w:gz') as archive:
    for path in pathlib.Path('/binaries').iterdir():
        if path.is_file() and path.name != 'raphie-smoke': archive.add(path, arcname=path.name)
pathlib.Path('/tmp/raphie-alpha-release.json').write_text(json.dumps({'tag_name':'v0.0.4-alpha.1','draft':False,'prerelease':True}))
(stub / 'apt-get').write_text('#!/bin/sh\nexit 0\n')
(stub / 'gh').write_text('#!/bin/sh\nexit 99\n')
(stub / 'curl').write_text('''#!/bin/sh
case "$2" in
  *api.github.com*) cp /tmp/raphie-alpha-release.json "$4";;
  *) cp /tmp/raphie-public-alpha.tar.gz "$4";;
esac
''')
for name in ('apt-get','gh','curl'): (stub / name).chmod(0o755)
subprocess.run(['sh', '/test-bootstrap/bootstrap.sh', 'v0.0.4-alpha.1', '--web-origin', 'https://agent.example.ts.net'], check=True, env=env, stdout=subprocess.DEVNULL)
subprocess.run(['/usr/local/bin/raphie', 'health'], check=True, env=env)
default_marker = pathlib.Path('/var/lib/raphie/data/preserved')
default_marker.write_text('data')
subprocess.run(['/usr/local/bin/raphie', 'update', '/tmp/raphie-new-bundle'], check=True, env=env, stdout=subprocess.DEVNULL)
default_backups = list(pathlib.Path('/var/backups/raphie').glob('raphie-*.tar'))
assert len(default_backups) == 1
interactive(['/usr/local/bin/raphie', 'restore', str(default_backups[0])], [(b'Type RESTORE to continue:', b'RESTORE')])
assert default_marker.read_text() == 'data'
pathlib.Path('/var/backups/raphie').mkdir(exist_ok=True)
pathlib.Path('/var/backups/raphie/preserved').write_text('backup')
interactive(['/usr/local/bin/raphie', 'uninstall'], [(b'Type UNINSTALL to continue:', b'UNINSTALL')])
assert default_marker.read_text() == 'data'
assert pathlib.Path('/var/backups/raphie/preserved').read_text() == 'backup'
assert pathlib.Path('/etc/raphie/keyring.cred').exists() and pathlib.Path('/var/lib/raphie').exists()
assert not pathlib.Path('/usr/local/bin/raphie').exists() and not pathlib.Path('/opt/raphie').exists()
assert subprocess.run(['id', 'raphie'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
print('Binary installation, update, restore and uninstall modes passed (systemd simulated).')
