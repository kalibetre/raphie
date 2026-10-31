#!/bin/sh
set -eu

# Download this script first, inspect it, then run it as root on Ubuntu/Debian.
test "$(id -u)" -eq 0 || { echo 'Run this installer with sudo.' >&2; exit 1; }
command -v apt-get >/dev/null || { echo 'This installer currently supports Debian and Ubuntu.' >&2; exit 1; }
if [ -e /etc/raphie ] || [ -e /opt/raphie ] || [ -e /var/lib/raphie ] || [ -e /usr/local/bin/raphie ] || id raphie >/dev/null 2>&1; then
  echo 'An existing Raphie installation or user was found; refusing to overwrite it.' >&2; exit 1
fi
if [ -e /usr/local/bin/bun ] && [ "$(/usr/local/bin/bun --version)" != 1.4.4 ]; then
  echo 'A different Bun already exists at /usr/local/bin/bun; refusing to replace it.' >&2; exit 1
fi
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl git unzip python3 dbus gnome-keyring libsecret-1-0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
if [ ! -x /usr/local/bin/bun ]; then
  case "$(uname -m)" in
    x86_64) platform=x64; checksum=bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c ;;
    aarch64|arm64) platform=aarch64; checksum=baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e ;;
    *) echo 'Unsupported Linux architecture.' >&2; exit 1 ;;
  esac
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-$platform.zip" -o "$tmp/bun.zip"
  printf '%s  %s\n' "$checksum" "$tmp/bun.zip" | sha256sum -c -
  unzip -q "$tmp/bun.zip" -d "$tmp"
  install -m 0755 "$tmp/bun-linux-$platform/bun" /usr/local/bin/bun
fi
requested=${1:-}
if [ -n "$requested" ]; then
  printf '%s' "$requested" | python3 -c 'import re,sys; re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", sys.stdin.read()) or sys.exit("Expected a version such as v1.2.3.")'
  release_url="https://api.github.com/repos/kalibetre/raphie/releases/tags/$requested"
else
  release_url=https://api.github.com/repos/kalibetre/raphie/releases/latest
fi
tag=$(curl -fsSL "$release_url" | python3 -c 'import json,re,sys; r=json.load(sys.stdin); t=r.get("tag_name", ""); (not r.get("draft") and not r.get("prerelease") and re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", t)) or sys.exit("No stable Raphie release is available."); print(t)')
test -z "$requested" || test "$tag" = "$requested"
git clone --quiet --depth 1 --branch "$tag" https://github.com/kalibetre/raphie.git "$tmp/source"
test "$(git -C "$tmp/source" describe --tags --exact-match HEAD)" = "$tag"
sh "$tmp/source/scripts/linux-install/install.sh"
