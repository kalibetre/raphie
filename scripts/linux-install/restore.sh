#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then echo 'Run restore as root.' >&2; exit 1; fi
backup=${1:?Usage: raphie restore /var/backups/raphie/raphie-XXXXXXXX.tar}
backup=$(realpath -e "$backup")
case "$backup" in /var/backups/raphie/raphie-*.tar) ;; *) echo 'Select a Raphie backup under /var/backups/raphie.' >&2; exit 1;; esac
test -f "$backup.release" || { echo 'The backup release metadata is missing.' >&2; exit 1; }
revision=$(cat "$backup.release")
case "$revision" in *[!0-9a-f]*|'') echo 'Invalid backup release.' >&2; exit 1;; esac
test "${#revision}" -eq 40 && test -d "/opt/raphie/releases/$revision" || { echo 'The matching release is not installed.' >&2; exit 1; }
printf 'Restoring replaces the current data with this backup. Type RESTORE to continue: ' >&2
IFS= read -r confirmation
test "$confirmation" = RESTORE || { echo 'Restore cancelled.' >&2; exit 1; }
exec 9>/run/lock/raphie-update.lock
flock -n 9 || { echo 'Another update or restore is running.' >&2; exit 1; }
systemctl stop raphie.service
stage=$(mktemp -d /var/lib/raphie/.restore-XXXXXXXX)
chown raphie:raphie "$stage"
if ! runuser -u raphie -- tar -xf - -C "$stage" < "$backup"; then
  echo 'Backup extraction failed; restarting the existing release.' >&2
  systemctl start raphie.service 9>&-
  exit 1
fi
test -d "$stage/data" || { echo "Backup is missing data; service remains stopped. Staging: $stage" >&2; exit 1; }
echo "Current data will be preserved at $stage.before-data"
mv /var/lib/raphie/data "$stage.before-data"
mv "$stage/data" /var/lib/raphie/data
install -d -m 0700 -o raphie -g raphie /var/lib/raphie/.local/share
if [ -e /var/lib/raphie/.local/share/keyrings ]; then
  mv /var/lib/raphie/.local/share/keyrings "$stage.before-keyrings"
fi
if [ -d "$stage/.local/share/keyrings" ]; then
  mv "$stage/.local/share/keyrings" /var/lib/raphie/.local/share/keyrings
fi
ln -s "/opt/raphie/releases/$revision" /opt/raphie/current.restore
mv -Tf /opt/raphie/current.restore /opt/raphie/current
install -m 0644 "/opt/raphie/current/scripts/linux-install/raphie.service" /etc/systemd/system/raphie.service
install -m 0755 "/opt/raphie/current/scripts/linux-install/raphie" /usr/local/bin/raphie
systemctl daemon-reload
if ! systemctl start raphie.service 9>&-; then
  echo "Service did not start. Current data and keyrings remain at $stage.before-*" >&2
  exit 1
fi
ready=false
attempt=0
while [ "$attempt" -lt 30 ]; do
  if ! systemctl is-active --quiet raphie.service; then break; fi
  if /usr/local/bin/bun "/opt/raphie/current/scripts/linux-install/health.ts" >/dev/null 2>&1; then ready=true; break; fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" != true ]; then
  systemctl stop raphie.service || true
  echo "Restored service is not ready. Previous data and keyrings remain at $stage.before-*" >&2
  exit 1
fi
echo "Restored release $revision. Previous data and keyrings remain at $stage.before-*"
