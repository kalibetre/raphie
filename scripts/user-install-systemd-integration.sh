#!/bin/bash
# Run only on a disposable Linux CI runner: starts a real systemd user unit.
set -euo pipefail
[ "${CI:-}" = true ] && [ "${RAPHIE_DISPOSABLE_TEST:-}" = 1 ] || { echo 'Run only on a disposable CI runner.' >&2; exit 1; }
if ! /usr/bin/systemctl --user show-environment >/dev/null 2>&1; then
  echo 'SKIP: no systemd user manager is available on this runner.'
  exit 0
fi
binaries=${1:?Pass the absolute path to compiled Linux binaries}
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
real_home=$HOME
if [ -e "$real_home/.config/systemd/user/raphie.service" ]; then echo 'A user service already exists; refusing to modify it.' >&2; exit 1; fi
cleanup() {
  /usr/bin/systemctl --user disable --now raphie.service >/dev/null 2>&1 || true
  rm -f "$real_home/.config/systemd/user/raphie.service"
  /usr/bin/systemctl --user daemon-reload >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/home" "$work/bin" "$work/fixtures"
asset="raphie-linux-$(uname -m).tar.gz"
case "$asset" in raphie-linux-x86_64.tar.gz) asset=raphie-linux-x64.tar.gz;; raphie-linux-aarch64.tar.gz) asset=raphie-linux-arm64.tar.gz;; esac
tar -czf "$work/fixtures/archive.tar.gz" -C "$binaries" raphie raphie-runtime raphie-web
python3 - "$work/fixtures" "$asset" <<'PY'
import hashlib, json, os, sys
path, asset = sys.argv[1:]
hash = hashlib.sha256()
with open(os.path.join(path, 'archive.tar.gz'), 'rb') as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b''): hash.update(chunk)
with open(os.path.join(path, 'SHA256SUMS'), 'w') as f: f.write(f'{hash.hexdigest()}  {asset}\n')
with open(os.path.join(path, 'release.json'), 'w') as f: json.dump([{'tag_name':'v0.0.4-alpha.2', 'draft':False, 'prerelease':True, 'assets':[{'name':asset}, {'name':'SHA256SUMS'}]}], f)
PY
cat > "$work/bin/curl" <<'SH'
#!/bin/sh
case "$2" in *api.github.com*) cp "$FIXTURE/release.json" "$4";; *SHA256SUMS) cp "$FIXTURE/SHA256SUMS" "$4";; *) cp "$FIXTURE/archive.tar.gz" "$4";; esac
SH
cat > "$work/bin/systemctl" <<'SH'
#!/bin/sh
# The manager searches its original HOME, while the installer uses a scratch HOME.
if [ "$1" = --user ] && [ "$2" = daemon-reload ]; then
  /usr/bin/systemctl --user link "$HOME/.config/systemd/user/raphie.service"
fi
exec /usr/bin/systemctl "$@"
SH
chmod 755 "$work/bin/curl" "$work/bin/systemctl"
export HOME="$work/home" PATH="$work/bin:/usr/bin:/bin" FIXTURE="$work/fixtures" XDG_DATA_HOME="$work/data"
printf 'synthetic-only\n' | gnome-keyring-daemon --unlock >/dev/null
cat "$root/scripts/install.sh" | bash
/usr/bin/systemctl --user is-active --quiet raphie.service
PORT=4316 RAPHIE_WEB_PORT=4320 "$HOME/.local/bin/raphie" health
echo 'Real user systemd service started and passed health checks.'
