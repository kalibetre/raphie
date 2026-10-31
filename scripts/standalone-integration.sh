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
env -i PATH=/usr/bin:/bin python3 -c '
import http.server, os, subprocess, sys, threading
class Runtime(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/api/runtime" else 404); self.end_headers()
    def log_message(self, *args): pass
class Web(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.path == "/_raphie/health"
        self.send_response(200 if ok else 404); self.end_headers()
        self.wfile.write(b"{\"status\":\"locked\"}")
    def log_message(self, *args): pass
servers = [http.server.HTTPServer(("127.0.0.1", 0), handler) for handler in (Runtime, Web)]
threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
for thread in threads: thread.start()
env = dict(os.environ, PORT=str(servers[0].server_port), RAPHIE_WEB_PORT=str(servers[1].server_port))
try:
    if subprocess.run([sys.argv[1], "health"], env=env).returncode: raise SystemExit("Compiled health check failed")
    servers[0].shutdown()
    if subprocess.run([sys.argv[1], "health"], env=env).returncode == 0: raise SystemExit("Compiled health check accepted an unavailable runtime")
finally:
    servers[1].shutdown()
    for server in servers: server.server_close()
print("Compiled installation health checks passed.")
' "$directory/raphie"
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
  until curl -fsS "http://127.0.0.1:$RAPHIE_WEB_PORT/_raphie/health" >"$2/health.json" 2>/dev/null; do
    if ! kill -0 "$pid" 2>/dev/null || [ "$attempt" -ge 30 ]; then
      cat "$2/service.log" >&2
      echo "Compiled service did not become ready." >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  base="http://127.0.0.1:$RAPHIE_WEB_PORT"
  status() { curl -sS -o /dev/null -w "%{http_code}" "$@"; }
  # Locked: nothing but the sign-in page and health is reachable before an administrator exists.
  test "$(status "$base/api/runtime")" = 503
  test "$(status -H "Accept: text/html" "$base/")" = 303
  python3 "$3" "$1/raphie" admin@example.test "a long scratch password"
  test "$(status "$base/api/runtime")" = 401
  test "$(status "$base/_raphie/version")" = 401
  test "$(status -X POST -H "Content-Type: application/json" -d "{\"email\":\"admin@example.test\",\"password\":\"wrong password here\"}" -H "Origin: $RAPHIE_WEB_ORIGIN" "$base/api/auth/sign-in/email")" = 401
  curl -fsS -c "$2/cookies" -X POST -H "Content-Type: application/json" -H "Origin: $RAPHIE_WEB_ORIGIN" -d "{\"email\":\"admin@example.test\",\"password\":\"a long scratch password\"}" "$base/api/auth/sign-in/email" >/dev/null
  curl -fsS -b "$2/cookies" "$base/api/runtime" >"$2/runtime.json"
  python3 -c '\''import json,sys; x=json.load(open(sys.argv[1])); assert "identity" in x'\'' "$2/runtime.json"
  curl -fsS -b "$2/cookies" "$base/_raphie/version" >"$2/version.json"
  python3 -c '\''import json,sys; x=json.load(open(sys.argv[1])); assert x.get("id") and x.get("version")'\'' "$2/version.json"
  curl -fsS -b "$2/cookies" "$base/" >"$2/index.html"
  python3 -c '\''import re,sys; h=open(sys.argv[1]).read(); p=re.findall(r"(?:href|src)=\"([^\"]+\.(?:css|js))\"",h); assert p; print("\n".join(p))'\'' "$2/index.html" >"$2/assets"
  while IFS= read -r path; do curl -fsS "$base$path" >/dev/null; done <"$2/assets"
  curl -fsS -b "$2/cookies" -c "$2/cookies" -X POST -H "Content-Type: application/json" -H "Origin: $RAPHIE_WEB_ORIGIN" -d "{}" "$base/api/auth/sign-out" >/dev/null
  test "$(status -b "$2/cookies" "$base/api/runtime")" = 401
  echo "Compiled launcher, locked state, administrator setup, sign-in, gateway, assets and sign-out passed."
' sh "$directory" "$temp" "$(dirname "$0")/standalone-admin.py"
