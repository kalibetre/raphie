#!/bin/sh
set -eu
test "$(id -u)" -eq 0 || { echo 'Run restore as root.' >&2; exit 1; }
backup=${1:?Usage: sudo raphie restore BACKUP [--recovery-key ENCRYPTED --identity AGE_IDENTITY]}
recovery=false
if [ "$#" -eq 5 ] && [ "$2" = --recovery-key ] && [ "$4" = --identity ]; then
  recovery=true
  recovery_key=$3
  identity=$5
elif [ "$#" -ne 1 ]; then
  echo 'Usage: sudo raphie restore BACKUP [--recovery-key ENCRYPTED --identity AGE_IDENTITY]' >&2; exit 1
fi
backup=$(realpath -e "$backup")
case "$backup" in /var/backups/raphie/raphie-*.tar) ;; *) echo 'Select a Raphie backup under /var/backups/raphie.' >&2; exit 1;; esac
test -f "$backup.release" || { echo 'Backup release metadata is missing.' >&2; exit 1; }
revision=$(cat "$backup.release")
case "$revision" in *[!0-9a-f]*|'') echo 'Invalid backup release.' >&2; exit 1;; esac
test "${#revision}" -eq 64 && test -d "/opt/raphie/releases/$revision" || { echo 'Matching release is not installed.' >&2; exit 1; }
. /etc/raphie/raphie.conf
if [ "$DATA_DIRECTORY" = /var/lib/raphie/data ]; then
  stage_parent=/var/lib
else
  stage_parent=$(dirname "$DATA_DIRECTORY")
fi
python3 - "$DATA_DIRECTORY" "$stage_parent" <<'PY'
import os, stat, sys
data, parent = sys.argv[1:]
if not data.startswith('/') or os.path.normpath(data) != data or os.path.realpath(data) != data:
    raise SystemExit('Unsafe data directory; refusing restore.')
if not os.path.isdir(data) or os.stat(data).st_dev != os.stat(parent).st_dev:
    raise SystemExit('Data and staging must be directories on the same filesystem.')
while True:
    info = os.lstat(parent)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise SystemExit('Restore staging parents must be root-owned and not group- or world-writable.')
    if parent == '/': break
    parent = os.path.dirname(parent)
PY
printf 'Restoring replaces the current data with this backup. Type RESTORE to continue: ' >&2
IFS= read -r confirmation
test "$confirmation" = RESTORE || { echo 'Restore cancelled.' >&2; exit 1; }
exec 9>/run/lock/raphie-update.lock
flock -n 9 || { echo 'Another update or restore is running.' >&2; exit 1; }
credential_stage=
trap '[ -z "$credential_stage" ] || rm -rf "$credential_stage"' EXIT HUP INT TERM
if [ "$recovery" = true ]; then
  umask 077
  credential_stage=$(mktemp -d /etc/raphie/.recovery-XXXXXXXX)
  python3 /opt/raphie/current/recovery-key.py rewrap "$recovery_key" "$identity" "$credential_stage/keyring.cred"
fi
systemctl stop raphie.service
stage=$(mktemp -d "$stage_parent/.raphie-restore-XXXXXXXX")
chown raphie:raphie "$stage"
if ! runuser -u raphie -- tar -xf - -C "$stage" < "$backup"; then
  echo 'Backup extraction failed; restarting the existing service.' >&2
  systemctl start raphie.service 9>&-
  exit 1
fi
# Freeze the untrusted extraction before root inspects or moves its contents.
# Recursive ownership changes do not follow archive symlinks.
chown -hR root:root "$stage"
test -d "$stage/data" && test "$(realpath -e "$stage/data")" = "$stage/data" || { echo "Backup is missing a data directory; service remains stopped. Staging: $stage" >&2; exit 1; }
keyrings="$stage/.local/share/keyrings"
if [ -e "$keyrings" ] || [ -L "$keyrings" ]; then
  test -d "$keyrings" && test "$(realpath -e "$keyrings")" = "$keyrings" || { echo "Backup contains an unsafe keyring path; service remains stopped. Staging: $stage" >&2; exit 1; }
elif [ "$recovery" = true ]; then
  echo "Backup is missing keyrings; service remains stopped. Staging: $stage" >&2; exit 1
fi
if [ "$recovery" = true ]; then
  cp -p /etc/raphie/keyring.cred "$stage.before-credential"
  mv "$credential_stage/keyring.cred" /etc/raphie/keyring.cred
fi
mv "$DATA_DIRECTORY" "$stage.before-data"
mv "$stage/data" "$DATA_DIRECTORY"
install -d -m 0700 -o raphie -g raphie /var/lib/raphie/.local/share
if [ -e /var/lib/raphie/.local/share/keyrings ]; then mv /var/lib/raphie/.local/share/keyrings "$stage.before-keyrings"; fi
if [ -d "$keyrings" ]; then mv "$keyrings" /var/lib/raphie/.local/share/keyrings; fi
chown -hR raphie:raphie "$DATA_DIRECTORY"
if [ -d /var/lib/raphie/.local/share/keyrings ]; then chown -hR raphie:raphie /var/lib/raphie/.local/share/keyrings; fi
ln -s "/opt/raphie/releases/$revision" /opt/raphie/current.restore
mv -Tf /opt/raphie/current.restore /opt/raphie/current
install -m 0644 /opt/raphie/current/raphie.service /etc/systemd/system/raphie.service
install -m 0755 /opt/raphie/current/raphie-admin /usr/local/bin/raphie
systemctl daemon-reload
ready=false
if systemctl start raphie.service 9>&-; then
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if ! systemctl is-active --quiet raphie.service; then break; fi
    if /usr/local/bin/raphie health >/dev/null 2>&1; then ready=true; break; fi
    attempt=$((attempt + 1))
    sleep 1
  done
fi
if [ "$ready" != true ]; then
  systemctl stop raphie.service || true
  echo "Restored service is not ready. Previous data, keyrings, and any replaced host credential remain at $stage.before-*" >&2
  exit 1
fi
echo "Restored release $revision. Previous data, keyrings, and any replaced host credential remain at $stage.before-*"
