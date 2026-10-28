#!/bin/sh
set -eu

# Experimental local installation from a build prepared by this checkout.
usage='Usage: sudo sh install.sh [--data-dir /absolute/path] [--web-origin URL]'
data_dir=/var/lib/raphie/data
origin=http://127.0.0.1:4320
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data-dir) [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 1; }; data_dir=$2; shift 2 ;;
    --web-origin) [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 1; }; origin=$2; shift 2 ;;
    --help) echo "$usage"; exit 0 ;;
    *) echo "$usage" >&2; exit 1 ;;
  esac
done
test "$(id -u)" -eq 0 || { echo 'Run this installer with sudo.' >&2; exit 1; }
for executable in runuser useradd systemctl systemd-creds dbus-run-session gnome-keyring-daemon python3; do
  command -v "$executable" >/dev/null || { echo "Missing required command: $executable" >&2; exit 1; }
done
case "$data_dir" in /*) ;; *) echo 'The data directory must be absolute.' >&2; exit 1;; esac
case "$data_dir" in *[!a-zA-Z0-9._/-]*|/|*/../*|*/..|*/./*|*/.|*//*|*/) echo 'Invalid data directory.' >&2; exit 1;; esac
case "$data_dir" in
  /var/lib/raphie/data) ;;
  /var/lib/raphie|/var/lib/raphie/*|/opt/raphie|/opt/raphie/*|/etc/raphie|/etc/raphie/*|/var/backups/raphie|/var/backups/raphie/*)
    echo 'The data directory must not overlap Raphie system or backup files.' >&2; exit 1 ;;
esac
test "$(realpath -m "$data_dir")" = "$data_dir" || { echo 'The data path must not contain symlinks.' >&2; exit 1; }
python3 - "$data_dir" <<'PY'
import os, stat, sys
path = os.path.dirname(sys.argv[1])
while True:
    if os.path.lexists(path):
        info = os.lstat(path)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise SystemExit('Existing parent directories must be root-owned and not group- or world-writable.')
    if path == '/':
        break
    path = os.path.dirname(path)
PY
case "$origin" in *[!a-zA-Z0-9.:/-]*|'') echo 'Invalid browser origin.' >&2; exit 1;; esac
python3 - "$origin" <<'PY'
import sys, urllib.parse
try:
    value = sys.argv[1]
    url = urllib.parse.urlsplit(value)
    valid = (url.scheme in ('http', 'https') and url.hostname and not url.username
             and not url.password and not url.path and not url.query and not url.fragment
             and url.port not in (80 if url.scheme == 'http' else 443,)
             and url.netloc == url.hostname + ((':' + str(url.port)) if url.port else ''))
except ValueError:
    valid = False
if not valid:
    raise SystemExit('Enter an HTTP or HTTPS origin without a path.')
PY
case "$origin" in https://*|http://localhost|http://localhost:*|http://127.0.0.1|http://127.0.0.1:*) ;; *) echo 'Pairing requires HTTPS or a loopback HTTP origin.' >&2; exit 1;; esac
if [ -e /etc/raphie ] || [ -e /opt/raphie ] || [ -e /var/lib/raphie ] || [ -e /usr/local/bin/raphie ] || [ -e "$data_dir" ] || id raphie >/dev/null 2>&1; then
  echo 'An existing installation or data directory was found; refusing to overwrite it.' >&2; exit 1
fi
bundle=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
for file in raphie raphie-runtime raphie-web raphie.service raphie-admin keyring-session.sh update.sh restore.sh bundle-id.sh; do
  test -f "$bundle/$file" && test ! -L "$bundle/$file" || { echo "Missing bundle file: $file" >&2; exit 1; }
done
revision=$(sh "$bundle/bundle-id.sh" "$bundle")
useradd --system --user-group --home-dir /var/lib/raphie --create-home --shell /usr/sbin/nologin raphie
install -d -m 0700 -o raphie -g raphie "$data_dir"
install -d -m 0755 "/opt/raphie/releases/$revision"
for file in raphie raphie-runtime raphie-web raphie-admin keyring-session.sh update.sh restore.sh bundle-id.sh; do install -m 0755 "$bundle/$file" "/opt/raphie/releases/$revision/$file"; done
install -m 0644 "$bundle/raphie.service" "/opt/raphie/releases/$revision/raphie.service"
install -d -m 0700 /etc/raphie
printf 'DATA_DIRECTORY=%s\nRAPHIE_WEB_ORIGIN=%s\nRAPHIE_WEB_BIND=127.0.0.1\nRAPHIE_WEB_PORT=4320\n' "$data_dir" "$origin" > /etc/raphie/raphie.conf
chmod 0600 /etc/raphie/raphie.conf
umask 077
head -c 32 /dev/urandom | base64 | systemd-creds encrypt --with-key=host --name=raphie-keyring - /etc/raphie/keyring.cred
ln -s "/opt/raphie/releases/$revision" /opt/raphie/current
install -m 0644 /opt/raphie/current/raphie.service /etc/systemd/system/raphie.service
install -m 0755 /opt/raphie/current/raphie-admin /usr/local/bin/raphie
systemctl daemon-reload
systemctl enable --now raphie.service
ready=false
attempt=0
while [ "$attempt" -lt 30 ]; do
  if ! systemctl is-active --quiet raphie.service; then break; fi
  if /usr/local/bin/raphie health >/dev/null 2>&1; then ready=true; break; fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" != true ]; then
  systemctl stop raphie.service || true
  echo 'Installation was created but the service did not become ready. Check journalctl -u raphie.' >&2
  exit 1
fi
echo "Raphie installed. Run sudo raphie pair to connect your first device."
