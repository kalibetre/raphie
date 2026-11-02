#!/bin/sh
set -eu

# Download and inspect this script before running.
test "$(id -u)" -eq 0 || { echo 'Run this installer with sudo.' >&2; exit 1; }
usage='Usage: sudo sh bootstrap.sh [version] [--web-origin URL] [--web-port PORT] [--data-dir PATH]'
version=
origin=
port=
data_dir=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --web-port) [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 1; }; port=$2; shift 2 ;;
    --web-origin) [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 1; }; origin=$2; shift 2 ;;
    --data-dir) [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 1; }; data_dir=$2; shift 2 ;;
    --help|-h) echo "$usage"; exit 0 ;;
    -*) echo "$usage" >&2; exit 1 ;;
    *) [ -z "$version" ] || { echo "$usage" >&2; exit 1; }; version=$1; shift ;;
  esac
done
command -v apt-get >/dev/null || { echo 'This installer currently supports Debian and Ubuntu.' >&2; exit 1; }
if [ -e /etc/raphie ] || [ -e /opt/raphie ] || [ -e /var/lib/raphie ] || [ -e /usr/local/bin/raphie ] || id raphie >/dev/null 2>&1; then
  echo 'An existing Raphie installation or user was found; refusing to overwrite it.' >&2; exit 1
fi
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl python3 dbus gnome-keyring libsecret-1-0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/bundle"
(
  set -- "$tmp/bundle" "$version"
# BEGIN EMBEDDED DOWNLOAD-RELEASE (keep in sync with download-release.sh)
set -eu

# Fetch public releases from GitHub. Alpha releases must be selected explicitly;
# the default remains the latest stable release.
destination=${1:?Destination directory required}
requested=${2:-}
test "$#" -le 2 || { echo 'Expected destination and optional version.' >&2; exit 1; }
for command in curl python3; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
case "$(uname -m)" in
  x86_64) asset=raphie-linux-x64.tar.gz ;;
  aarch64|arm64) asset=raphie-linux-arm64.tar.gz ;;
  *) echo 'Unsupported Linux architecture.' >&2; exit 1 ;;
esac
if [ -n "$requested" ]; then
  printf '%s' "$requested" | python3 -c 'import re,sys; re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-alpha\.[0-9]+)?", sys.stdin.read()) or sys.exit("Expected a version such as v1.2.3 or v1.2.3-alpha.1.")'
  url="https://api.github.com/repos/kalibetre/raphie/releases/tags/$requested"
else
  url=https://api.github.com/repos/kalibetre/raphie/releases/latest
fi
test -d "$destination" && test -z "$(ls -A "$destination")" || { echo 'Destination must be an empty directory.' >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl -fsSL "$url" -o "$tmp/release.json"
tag=$(python3 - "$tmp/release.json" "$requested" <<'PY'
import json, re, sys
with open(sys.argv[1]) as f: release = json.load(f)
tag = release.get('tag_name', '')
if not isinstance(tag, str) or not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-alpha\.[0-9]+)?', tag):
    raise SystemExit('No matching Raphie release is available.')
alpha = '-alpha.' in tag
if release.get('draft') is not False or release.get('prerelease') is not alpha or (sys.argv[2] and tag != sys.argv[2]) or (not sys.argv[2] and alpha):
    raise SystemExit('No matching Raphie release is available.')
print(tag)
PY
)
curl -fsSL "https://github.com/kalibetre/raphie/releases/download/$tag/$asset" -o "$tmp/$asset"
python3 - "$tmp/$asset" "$destination" <<'PY'
import os, re, sys, tarfile
expected = {'raphie', 'raphie-runtime', 'raphie-web', 'install.sh', 'raphie.service', 'raphie-admin', 'keyring-session.sh', 'update.sh', 'restore.sh', 'uninstall.sh', 'recovery-key.py', 'bundle-id.sh', 'download-release.sh'}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    names = [m.name for m in members]
    if len(names) > 64 or len(names) != len(set(names)) or 'raphie-smoke' in names or not expected.issubset(names) or any(not m.isfile() or m.size > 500_000_000 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', m.name) for m in members):
        raise SystemExit('Invalid release archive contents.')
    for member in members:
        with archive.extractfile(member) as source, open(os.path.join(sys.argv[2], member.name), 'xb') as target:
            while chunk := source.read(1024 * 1024): target.write(chunk)
        os.chmod(os.path.join(sys.argv[2], member.name), 0o644 if member.name == 'raphie.service' else 0o755)
PY
echo "Downloaded $tag ($asset)."
# END EMBEDDED DOWNLOAD-RELEASE
)
set --
if [ -n "$port" ]; then set -- "$@" --web-port "$port"; fi
if [ -n "$origin" ]; then set -- "$@" --web-origin "$origin"; fi
if [ -n "$data_dir" ]; then set -- "$@" --data-dir "$data_dir"; fi
sh "$tmp/bundle/install.sh" "$@"
