#!/bin/bash
# Run only on a disposable macOS CI runner; creates and selects a scratch Keychain.
set -euo pipefail
[ "${RAPHIE_DISPOSABLE_TEST:-}" = 1 ] || { echo 'Run only on a disposable test runner.' >&2; exit 1; }
binaries=${1:?Pass the absolute path to the compiled macOS binaries}
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
pid=
keychain="$work/fixture.keychain-db"
previous=$(/usr/bin/security default-keychain -d user | tr -d '"' | xargs)
cleanup() {
  [ -z "$pid" ] || { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }
  [ -z "$previous" ] || /usr/bin/security default-keychain -d user -s "$previous" >/dev/null 2>&1 || true
  /usr/bin/security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
/usr/bin/security create-keychain -p synthetic-only "$keychain"
/usr/bin/security unlock-keychain -p synthetic-only "$keychain"
/usr/bin/security default-keychain -d user -s "$keychain"
mkdir -p "$work/home" "$work/bin" "$work/fixtures"
asset="raphie-darwin-$(uname -m).tar.gz"
[ "$asset" != raphie-darwin-x86_64.tar.gz ] || asset=raphie-darwin-x64.tar.gz
COPYFILE_DISABLE=1 tar -czf "$work/fixtures/archive.tar.gz" -C "$binaries" raphie raphie-runtime raphie-web
python3 - "$work/fixtures" "$asset" <<'PY'
import hashlib, json, os, sys
path, asset = sys.argv[1:]
digest = hashlib.sha256()
with open(os.path.join(path, 'archive.tar.gz'), 'rb') as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b''): digest.update(chunk)
digest = digest.hexdigest()
with open(os.path.join(path, 'SHA256SUMS'), 'w') as f: f.write(f'{digest}  {asset}\n')
with open(os.path.join(path, 'release.json'), 'w') as f: json.dump([{'tag_name':'v0.0.4', 'draft':False, 'prerelease':False, 'assets':[{'name':asset}, {'name':'SHA256SUMS'}]}], f)
PY
cat > "$work/bin/curl" <<'SH'
#!/bin/sh
case "$2" in *api.github.com*) cp "$FIXTURE/release.json" "$4";; *SHA256SUMS) cp "$FIXTURE/SHA256SUMS" "$4";; *) cp "$FIXTURE/archive.tar.gz" "$4";; esac
SH
printf '#!/bin/sh\nexit 1\n' > "$work/bin/launchctl"
chmod 755 "$work/bin/curl" "$work/bin/launchctl"
export HOME="$work/home" PATH="$work/bin:/usr/bin:/bin:/usr/sbin:/sbin" FIXTURE="$work/fixtures"
# launchctl is deliberately unavailable on this headless runner. The installer
# must report the failed service setup, while leaving the binaries runnable.
if cat "$root/scripts/install.sh" | bash; then echo 'Expected a service-setup failure.' >&2; exit 1; fi
test -x "$HOME/.local/bin/raphie"
"$HOME/.local/bin/raphie" channel nightly
"$HOME/.local/bin/raphie" channel | grep -q nightly
"$HOME/.local/bin/raphie" channel stable
ports=$(python3 -c 'import socket; s=[socket.socket(),socket.socket()]; [x.bind(("127.0.0.1",0)) for x in s]; print(*[x.getsockname()[1] for x in s])')
read -r PORT RAPHIE_WEB_PORT <<< "$ports"
export PORT RAPHIE_WEB_PORT DATA_DIRECTORY="$work/data" RAPHIE_WEB_ORIGIN="http://127.0.0.1:$RAPHIE_WEB_PORT" RAPHIE_RUNTIME_URL="http://127.0.0.1:$PORT"
"$HOME/.local/bin/raphie" start >"$work/service.log" 2>&1 &
pid=$!
for attempt in {1..30}; do
  if /usr/bin/curl -fsS "http://127.0.0.1:$RAPHIE_WEB_PORT/_raphie/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$pid" 2>/dev/null || [ "$attempt" = 30 ]; then cat "$work/service.log" >&2; exit 1; fi
  sleep 1
done
python3 "$root/scripts/standalone-admin.py" "$HOME/.local/bin/raphie" admin@example.test 'a long scratch password'
echo 'Real macOS user-installed launcher, service and administrator setup passed.'
