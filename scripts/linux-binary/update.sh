#!/bin/sh
set -eu

# Local, administrator-supplied bundles only. No network download or signature
# verification is implemented yet; do not use this as a public updater.
test "$(id -u)" -eq 0 || { echo 'Run update as root.' >&2; exit 1; }
bundle=${1:?Usage: sudo raphie update /path/to/trusted/bundle}
test "$#" -eq 1 || { echo 'Expected one bundle directory.' >&2; exit 1; }
bundle=$(CDPATH='' cd -- "$bundle" && pwd)
. /etc/raphie/raphie.conf
exec 9>/run/lock/raphie-update.lock
flock -n 9 || { echo 'Another update or restore is running.' >&2; exit 1; }
revision=$(sh /opt/raphie/current/bundle-id.sh "$bundle")
target="/opt/raphie/releases/$revision"
previous=$(basename "$(readlink /opt/raphie/current)")
if [ "$previous" = "$revision" ]; then echo 'Already on this bundle.'; exit 0; fi
test ! -e "$target" || { echo 'Release already exists; refusing to overwrite it.' >&2; exit 1; }
install -d -m 0755 "$target"
for file in raphie raphie-runtime raphie-web raphie-admin keyring-session.sh update.sh restore.sh bundle-id.sh; do install -m 0755 "$bundle/$file" "$target/$file"; done
install -m 0644 "$bundle/raphie.service" "$target/raphie.service"
test "$(sh /opt/raphie/current/bundle-id.sh "$target")" = "$revision" || { echo 'Bundle changed while copying; refusing update.' >&2; exit 1; }
systemctl stop raphie.service
install -d -m 0700 /var/backups/raphie
backup=$(mktemp /var/backups/raphie/raphie-XXXXXXXX.tar)
chmod 0600 "$backup"
if ! tar -C "$DATA_DIRECTORY" --transform='s,^\.,data,' -cf "$backup" . ||
   { [ -d /var/lib/raphie/.local/share/keyrings ] && ! tar -C /var/lib/raphie -rf "$backup" .local/share/keyrings; }; then
  echo 'Backup failed; restarting the previous service.' >&2
  systemctl start raphie.service 9>&-
  exit 1
fi
printf '%s\n' "$previous" > "$backup.release"
chmod 0600 "$backup.release"
ln -s "$target" /opt/raphie/current.next
mv -Tf /opt/raphie/current.next /opt/raphie/current
install -m 0644 "$target/raphie.service" /etc/systemd/system/raphie.service
install -m 0755 "$target/raphie-admin" /usr/local/bin/raphie
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
  echo "Update failed; service stopped. Restore the data backup before rolling back: $backup" >&2
  exit 1
fi
echo "Updated to $revision. Offline backup: $backup"
