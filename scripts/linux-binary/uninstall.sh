#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || { echo 'Run uninstall as root.' >&2; exit 1; }
case "${1:-}" in
  '') purge=false; confirmation=UNINSTALL ;;
  --purge) purge=true; confirmation=PURGE ;;
  *) echo 'Usage: sudo raphie uninstall [--purge]' >&2; exit 1 ;;
esac
test "$#" -le 1 || { echo 'Usage: sudo raphie uninstall [--purge]' >&2; exit 1; }
. /etc/raphie/raphie.conf
# Refuse paths that could refer to a system directory, another user's files,
# a symlink, or a mounted filesystem (including nested mounts).
python3 - "$DATA_DIRECTORY" "$purge" <<'PY'
import os, pwd, stat, sys
path = sys.argv[1]
purge = sys.argv[2] == 'true'
if not path.startswith('/') or path == '/' or os.path.normpath(path) != path or os.path.realpath(path) != path:
    raise SystemExit('Unsafe data directory; refusing uninstall.')
if path == '/opt/raphie' or path.startswith('/opt/raphie/') or '/opt/raphie'.startswith(path + '/'):
    raise SystemExit('Data directory overlaps program files; refusing uninstall.')
if purge:
    for protected in ('/etc', '/opt', '/var/lib', '/var/backups', '/usr', '/home', '/root', '/tmp', '/srv'):
        if path == protected or protected.startswith(path + '/'):
            raise SystemExit('Unsafe data directory; refusing purge.')
    if path.startswith(('/etc/', '/opt/', '/usr/', '/var/backups/')) or path == '/var/lib/raphie' or (path.startswith('/var/lib/raphie/') and path != '/var/lib/raphie/data'):
        raise SystemExit('Unsafe data directory; refusing purge.')
    if os.path.lexists(path):
        st = os.lstat(path)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != pwd.getpwnam('raphie').pw_uid:
            raise SystemExit('Data directory is not owned by the Raphie user; refusing purge.')
roots = ['/opt/raphie']
if purge: roots += [path, '/var/lib/raphie', '/var/backups/raphie', '/etc/raphie']
for root in roots:
    with open('/proc/self/mountinfo') as f:
        for line in f:
            mount = line.split()[4].replace('\\040', ' ').replace('\\011', '\t').replace('\\012', '\n').replace('\\134', '\\')
            if mount == root or mount.startswith(root + '/'):
                raise SystemExit('A Raphie path contains a mount; refusing uninstall.')
PY
if [ "$purge" = true ]; then
  echo "This deletes Raphie data at $DATA_DIRECTORY, keyrings, configuration, and backups."
else
  echo "This removes the Raphie service and program files. Data at $DATA_DIRECTORY, configuration, keyrings, backups, and the Raphie user will be preserved."
fi
printf 'Type %s to continue: ' "$confirmation" >&2
IFS= read -r answer
test "$answer" = "$confirmation" || { echo 'Uninstall cancelled.' >&2; exit 1; }
exec 9>/run/lock/raphie-update.lock
flock -n 9 || { echo 'Another update, restore, or uninstall is running.' >&2; exit 1; }
systemctl disable --now raphie.service
rm -f /etc/systemd/system/raphie.service /usr/local/bin/raphie
systemctl daemon-reload
rm -rf /opt/raphie
if [ "$purge" = true ]; then
  rm -rf -- "$DATA_DIRECTORY" /var/backups/raphie /etc/raphie /var/lib/raphie
  userdel raphie
  echo 'Raphie and its data, configuration, keyrings, and backups were removed.'
else
  echo 'Raphie was removed. Data, configuration, keyrings, backups, and the service user remain.'
fi
