#!/bin/sh
set -eu

# Exercise prebuilt binaries on their target Linux architecture with scratch data.
directory=${1:?Usage: sh scripts/standalone-integration.sh /path/to/binaries}
case "$directory" in /*) ;; *) directory="$(pwd)/$directory";; esac
for command in dbus-run-session gnome-keyring-daemon curl python3; do
  command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 1; }
done
test -x "$directory/raphie" && test -x "$directory/raphie-runtime" && test -x "$directory/raphie-web" && test -x "$directory/raphie-smoke"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT HUP INT TERM
mkdir -p "$temp/home" "$temp/data"
ports=$(python3 -c 'import socket; s=[socket.socket(),socket.socket()]; [x.bind(("127.0.0.1",0)) for x in s]; print(*[x.getsockname()[1] for x in s])')
set -- $ports
runtime_port=$1
web_port=$2
env -i PATH=/usr/bin:/bin HOME="$temp/home" DATA_DIRECTORY="$temp/data" PORT="$runtime_port" RAPHIE_WEB_PORT="$web_port" RAPHIE_WEB_ORIGIN="http://127.0.0.1:$web_port" RAPHIE_RUNTIME_URL="http://127.0.0.1:$runtime_port" dbus-run-session -- sh -eu -c '
  printf "synthetic-only\n" | gnome-keyring-daemon --unlock >/dev/null
  "$1/raphie-smoke"
  "$1/raphie" start >"$2/service.log" 2>&1 &
  pid=$!
  trap '\''kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true'\'' EXIT HUP INT TERM
  attempt=0
  until curl -fsS "http://127.0.0.1:$RAPHIE_WEB_PORT/api/runtime" >"$2/runtime.json" 2>/dev/null; do
    if ! kill -0 "$pid" 2>/dev/null || [ "$attempt" -ge 30 ]; then
      cat "$2/service.log" >&2
      echo "Compiled service did not become ready." >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  python3 -c '\''import json,sys; x=json.load(open(sys.argv[1])); assert "identity" in x'\'' "$2/runtime.json"
  curl -fsS "http://127.0.0.1:$RAPHIE_WEB_PORT/_raphie/version" >"$2/version.json"
  python3 -c '\''import json,sys; x=json.load(open(sys.argv[1])); assert x.get("id") and x.get("version")'\'' "$2/version.json"
  curl -fsS "http://127.0.0.1:$RAPHIE_WEB_PORT/" >"$2/index.html"
  python3 -c '\''import re,sys; h=open(sys.argv[1]).read(); p=re.findall(r"(?:href|src)=\"([^\"]+\.(?:css|js))\"",h); assert p; print("\n".join(p))'\'' "$2/index.html" >"$2/assets"
  while IFS= read -r path; do curl -fsS "http://127.0.0.1:$RAPHIE_WEB_PORT$path" >/dev/null; done <"$2/assets"
  echo "Compiled launcher, runtime, web proxy, version and assets passed."
' sh "$directory" "$temp"
