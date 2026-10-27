#!/bin/sh
set -eu

# Update from a clean source checkout. A backup is made after stopping the
# service because database migrations cannot safely be reversed in place.
if [ "$(id -u)" -ne 0 ]; then echo 'Run this updater as root.' >&2; exit 1; fi
command -v flock >/dev/null || { echo 'flock is required.' >&2; exit 1; }
exec 9>/run/lock/raphie-update.lock
flock -n 9 || { echo 'Another update is running.' >&2; exit 1; }
source_dir=${1:?Usage: update.sh /path/to/clean/checkout}
test -L /opt/raphie/current && test -f /etc/systemd/system/raphie.service || { echo 'Raphie is not installed.' >&2; exit 1; }
test -z "$(git -C "$source_dir" status --porcelain)" || { echo 'The source checkout must be clean.' >&2; exit 1; }
revision=$(git -C "$source_dir" rev-parse --verify HEAD)
target="/opt/raphie/releases/$revision"
if [ "$(readlink /opt/raphie/current)" = "$target" ]; then echo 'Already on this version.'; exit 0; fi
if [ -e "$target" ]; then echo 'Release already exists; refusing to overwrite it.' >&2; exit 1; fi
install -d -m 0755 -o raphie -g raphie "$target"
git -C "$source_dir" archive HEAD | tar -x -C "$target"
chown -R raphie:raphie "$target"
runuser -u raphie -- env HOME=/var/lib/raphie /usr/local/bin/bun install --frozen-lockfile --cwd "$target"
runuser -u raphie -- env HOME=/var/lib/raphie /usr/local/bin/bun run --cwd "$target" build
# The service account must not be able to replace scripts executed by root.
chown -R root:root "$target"
chmod -R go-w "$target"
systemctl stop raphie.service
install -d -m 0700 /var/backups/raphie
backup=$(mktemp /var/backups/raphie/raphie-XXXXXXXX.tar)
chmod 0600 "$backup"
previous=$(basename "$(readlink /opt/raphie/current)")
printf '%s\n' "$previous" > "$backup.release"
chmod 0600 "$backup.release"
if [ -d /var/lib/raphie/.local/share/keyrings ]; then
  backup_paths='data .local/share/keyrings'
else
  backup_paths='data'
fi
# backup_paths contains only the fixed paths above, not user input.
# shellcheck disable=SC2086
if ! tar -C /var/lib/raphie -cf "$backup" $backup_paths; then
  echo 'Backup failed; restarting the previous service.' >&2
  systemctl start raphie.service 9>&-
  exit 1
fi
echo "Backup created: $backup"
ln -s "$target" /opt/raphie/current.next
mv -Tf /opt/raphie/current.next /opt/raphie/current
install -m 0644 "$target/scripts/linux-install/raphie.service" /etc/systemd/system/raphie.service
install -m 0755 "$target/scripts/linux-install/raphie" /usr/local/bin/raphie
systemctl daemon-reload
ready=false
if systemctl start raphie.service 9>&-; then
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if ! systemctl is-active --quiet raphie.service; then break; fi
    if /usr/local/bin/bun "$target/scripts/linux-install/health.ts" >/dev/null 2>&1; then ready=true; break; fi
    attempt=$((attempt + 1))
    sleep 1
  done
fi
if [ "$ready" != true ]; then
  echo "Update failed. The service is stopped. Data backup: $backup" >&2
  echo 'Do not restart an older release against migrated data. Restore the backup before rolling back.' >&2
  systemctl stop raphie.service || true
  exit 1
fi
echo "Raphie updated to $revision. Offline data backup: $backup"
