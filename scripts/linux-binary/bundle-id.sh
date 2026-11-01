#!/bin/sh
set -eu
directory=${1:?A bundle directory is required.}
python3 - "$directory" <<'PY'
import hashlib, os, re, stat, sys
directory = sys.argv[1]
required = {'raphie', 'raphie-runtime', 'raphie-web', 'install.sh', 'raphie.service', 'raphie-admin', 'keyring-session.sh', 'update.sh', 'restore.sh', 'uninstall.sh', 'recovery-key.py', 'bundle-id.sh', 'download-release.sh'}
names = sorted(name for name in os.listdir(directory) if name != 'raphie-smoke')
if len(names) > 64 or not required.issubset(names) or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', name) for name in names):
    raise SystemExit('Invalid bundle contents.')
result = hashlib.sha256()
for name in names:
    fd = os.open(os.path.join(directory, name), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 500_000_000:
            raise SystemExit('Invalid bundle file.')
        digest = hashlib.sha256()
        while chunk := file.read(1024 * 1024): digest.update(chunk)
        result.update(name.encode('ascii') + b'\0' + digest.digest())
print(result.hexdigest())
PY
