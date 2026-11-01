#!/usr/bin/env python3
"""Export or rewrap the keyring unlock credential without plaintext files."""
import base64
import os
import re
import subprocess
import sys


def command(args, *, data=None):
    try:
        return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        raise SystemExit('Credential operation failed. Check age, systemd credentials, and the recovery identity.') from None


def validate(value):
    try:
        decoded = base64.b64decode(value.strip(), validate=True)
    except (ValueError, TypeError):
        raise SystemExit('Invalid recovery credential.') from None
    if len(decoded) != 32 or value != base64.b64encode(decoded) + b'\n':
        raise SystemExit('Invalid recovery credential.')


def write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
    except BaseException:
        os.unlink(path)
        raise


if os.geteuid() != 0:
    raise SystemExit('Run as root.')
if len(sys.argv) == 4 and sys.argv[1] == 'export':
    recipient, output = sys.argv[2:]
    if not re.fullmatch(r'age1[023456789acdefghjklmnpqrstuvwxyz]{58}', recipient):
        raise SystemExit('Expected a native age public recipient.')
    credential = command(['systemd-creds', 'decrypt', '--name=raphie-keyring', '/etc/raphie/keyring.cred', '-'])
    validate(credential)
    encrypted = command(['age', '--encrypt', '--recipient', recipient], data=credential)
    write_new(output, encrypted)
    print('Encrypted recovery key exported. Keep the matching age identity separate and secure.')
elif len(sys.argv) == 5 and sys.argv[1] == 'rewrap':
    source, identity, output = sys.argv[2:]
    if not os.path.isfile(source) or os.path.getsize(source) > 8192:
        raise SystemExit('Invalid encrypted recovery key file.')
    if not os.path.isfile(identity) or os.path.getsize(identity) > 16384:
        raise SystemExit('Expected a native age identity file.')
    try:
        with open(identity, encoding='ascii') as f:
            lines = [line.strip() for line in f if line.strip() and not line.lstrip().startswith('#')]
    except (OSError, UnicodeError):
        raise SystemExit('Expected a native age identity file.') from None
    if len(lines) != 1 or not re.fullmatch(r'AGE-SECRET-KEY-1[0-9A-Z]{10,128}', lines[0]):
        raise SystemExit('Expected a native age identity file.')
    credential = command(['age', '--decrypt', '--identity', identity, source])
    validate(credential)
    wrapped = command(['systemd-creds', 'encrypt', '--with-key=host', '--name=raphie-keyring', '-', '-'], data=credential)
    write_new(output, wrapped)
else:
    raise SystemExit('Usage: recovery-key.py export RECIPIENT OUTPUT | rewrap ENCRYPTED IDENTITY OUTPUT')
