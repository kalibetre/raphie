#!/bin/sh
set -eu

# Download and inspect this script and download-release.sh before running.
test "$(id -u)" -eq 0 || { echo 'Run this installer with sudo.' >&2; exit 1; }
test "$#" -le 1 || { echo 'Usage: sudo sh bootstrap.sh [version]' >&2; exit 1; }
directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
test -f "$directory/download-release.sh" && test ! -L "$directory/download-release.sh" || { echo 'Place the inspected download-release.sh next to this script.' >&2; exit 1; }
command -v gh >/dev/null || { echo 'Install GitHub CLI with attestation support first.' >&2; exit 1; }
command -v apt-get >/dev/null || { echo 'This installer currently supports Debian and Ubuntu.' >&2; exit 1; }
if [ -e /etc/raphie ] || [ -e /opt/raphie ] || [ -e /var/lib/raphie ] || [ -e /usr/local/bin/raphie ] || id raphie >/dev/null 2>&1; then
  echo 'An existing Raphie installation or user was found; refusing to overwrite it.' >&2; exit 1
fi
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl python3 dbus gnome-keyring libsecret-1-0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/bundle"
sh "$directory/download-release.sh" "$tmp/bundle" "${1:-}"
sh "$tmp/bundle/install.sh"
