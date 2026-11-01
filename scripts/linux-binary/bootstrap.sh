#!/bin/sh
set -eu

# Download and inspect this script and download-release.sh before running.
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
directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
test -f "$directory/download-release.sh" && test ! -L "$directory/download-release.sh" || { echo 'Place the inspected download-release.sh next to this script.' >&2; exit 1; }
command -v apt-get >/dev/null || { echo 'This installer currently supports Debian and Ubuntu.' >&2; exit 1; }
if [ -e /etc/raphie ] || [ -e /opt/raphie ] || [ -e /var/lib/raphie ] || [ -e /usr/local/bin/raphie ] || id raphie >/dev/null 2>&1; then
  echo 'An existing Raphie installation or user was found; refusing to overwrite it.' >&2; exit 1
fi
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl python3 dbus gnome-keyring libsecret-1-0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/bundle"
sh "$directory/download-release.sh" "$tmp/bundle" "$version"
set --
if [ -n "$port" ]; then set -- "$@" --web-port "$port"; fi
if [ -n "$origin" ]; then set -- "$@" --web-origin "$origin"; fi
if [ -n "$data_dir" ]; then set -- "$@" --data-dir "$data_dir"; fi
sh "$tmp/bundle/install.sh" "$@"
