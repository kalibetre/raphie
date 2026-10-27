#!/bin/sh
set -eu

# Install a clean, committed checkout. This script must be run on the target
# Linux host, never against an existing installation.
if [ "$(id -u)" -ne 0 ]; then echo 'Run this installer as root.' >&2; exit 1; fi
for executable in git tar runuser useradd systemctl systemd-creds dbus-run-session gnome-keyring-daemon; do
  command -v "$executable" >/dev/null || { echo "Missing required command: $executable" >&2; exit 1; }
done
test -x /usr/local/bin/bun || { echo 'Install the pinned Bun version at /usr/local/bin/bun first.' >&2; exit 1; }
test "$(/usr/local/bin/bun --version)" = "1.4.4" || { echo 'Bun 1.4.4 is required.' >&2; exit 1; }
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
test -z "$(git -C "$source_dir" status --porcelain)" || { echo 'The source checkout must be clean.' >&2; exit 1; }
if [ -e /etc/raphie ] || [ -e /opt/raphie ] || [ -e /var/lib/raphie ] || [ -e /usr/local/bin/raphie ] || id raphie >/dev/null 2>&1; then
  echo 'An existing Raphie installation or user was found; refusing to overwrite it.' >&2; exit 1
fi
printf 'Browser URL (for example http://100.x.y.z:4320): ' >&2
IFS= read -r origin
printf 'Web bind address [127.0.0.1]: ' >&2
IFS= read -r bind
bind=${bind:-127.0.0.1}
# Keep the systemd environment file free of newlines, substitutions and secrets.
case "$origin" in *[!a-zA-Z0-9.:/-]*|'') echo 'Invalid URL.' >&2; exit 1;; esac
case "$bind" in *[!a-zA-Z0-9.:-]*|'') echo 'Invalid bind address.' >&2; exit 1;; esac
/usr/local/bin/bun -e 'const u = new URL(process.argv[1]); if (!["http:","https:"].includes(u.protocol) || u.origin !== process.argv[1] || u.username || u.password) process.exit(1)' "$origin" || { echo 'Enter an HTTP or HTTPS origin without a path.' >&2; exit 1; }
revision=$(git -C "$source_dir" rev-parse --verify HEAD)
version=$(git -C "$source_dir" describe --tags --exact-match HEAD 2>/dev/null || printf 'commit-%s' "$(printf %.12s "$revision")")
useradd --system --user-group --home-dir /var/lib/raphie --create-home --shell /usr/sbin/nologin raphie
install -d -m 0700 -o raphie -g raphie /var/lib/raphie/data
install -d -m 0755 /opt/raphie/releases
install -d -m 0755 -o raphie -g raphie "/opt/raphie/releases/$revision"
git -C "$source_dir" archive HEAD | tar -x -C "/opt/raphie/releases/$revision"
printf '%s\n%s\n' "$revision" "$version" > "/opt/raphie/releases/$revision/.raphie-build"
chown -R raphie:raphie "/opt/raphie/releases/$revision"
runuser -u raphie -- env HOME=/var/lib/raphie /usr/local/bin/bun install --frozen-lockfile --cwd "/opt/raphie/releases/$revision"
runuser -u raphie -- env HOME=/var/lib/raphie RAPHIE_BUILD_ID="$revision" RAPHIE_VERSION="$version" /usr/local/bin/bun run --cwd "/opt/raphie/releases/$revision" build
# The service account must not be able to replace scripts executed by root.
chown -R root:root "/opt/raphie/releases/$revision"
chmod -R go-w "/opt/raphie/releases/$revision"
runuser -u raphie -- env HOME=/var/lib/raphie DATA_DIRECTORY=/var/lib/raphie/data /usr/local/bin/bun "/opt/raphie/releases/$revision/scripts/raphie.ts" auth setup
install -d -m 0700 /etc/raphie
printf 'RAPHIE_WEB_ORIGIN=%s\nRAPHIE_WEB_BIND=%s\nRAPHIE_WEB_PORT=4320\n' "$origin" "$bind" > /etc/raphie/raphie.conf
chmod 0600 /etc/raphie/raphie.conf
umask 077
head -c 32 /dev/urandom | base64 | systemd-creds encrypt --with-key=host --name=raphie-keyring - /etc/raphie/keyring.cred
ln -s "/opt/raphie/releases/$revision" /opt/raphie/current
install -m 0644 "/opt/raphie/current/scripts/linux-install/raphie.service" /etc/systemd/system/raphie.service
install -m 0755 "/opt/raphie/current/scripts/linux-install/raphie" /usr/local/bin/raphie
systemctl daemon-reload
systemctl enable --now raphie.service
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
  echo 'Installation was created but the service did not become ready. Check journalctl -u raphie; no existing data was replaced.' >&2
  exit 1
fi
echo "Raphie installed. Open $origin and sign in. Check systemctl status raphie for service health."
