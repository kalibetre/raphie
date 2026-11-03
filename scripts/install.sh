#!/usr/bin/env bash
# Install Raphie for the current user. No system files or packages are changed.
set -euo pipefail
main() {

requested_channel=
headless=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --headless) headless=true; shift ;;
    --channel) [ "$#" -ge 2 ] || { echo 'Usage: bash install.sh [--channel stable|nightly] [--headless]' >&2; exit 1; }; [ -z "$requested_channel" ] || { echo 'Specify one channel.' >&2; exit 1; }; requested_channel=$2; shift 2 ;;
    *) echo 'Usage: bash install.sh [--channel stable|nightly] [--headless]' >&2; exit 1 ;;
  esac
done
case "$requested_channel" in ''|stable|nightly) ;; *) echo 'Choose either stable or nightly.' >&2; exit 1;; esac
for command in curl python3; do
  command -v "$command" >/dev/null || { echo "Raphie needs $command; install it and retry." >&2; exit 1; }
done
os=$(uname -s)
arch=$(uname -m)
if [ "$os" = Darwin ] && [ "$arch" = x86_64 ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
if [ "$os" = Linux ] && command -v ldd >/dev/null && ldd --version 2>&1 | grep -qi musl; then
  echo 'Raphie Linux binaries require glibc; musl/Alpine is not supported.' >&2; exit 1
fi
case "$os:$arch" in
  Linux:x86_64) platform=Linux; asset=raphie-linux-x64.tar.gz ;;
  Linux:aarch64|Linux:arm64) platform=Linux; asset=raphie-linux-arm64.tar.gz ;;
  Darwin:arm64) platform=Darwin; asset=raphie-darwin-arm64.tar.gz ;;
  Darwin:x86_64) platform=Darwin; asset=raphie-darwin-x64.tar.gz ;;
  *) echo 'This platform is not supported by the Raphie installer.' >&2; exit 1 ;;
esac
if [ "$headless" = true ]; then
  [ "$platform" = Linux ] || { echo '--headless is supported on Linux only.' >&2; exit 1; }
  command -v systemctl >/dev/null || { echo 'Headless setup needs systemctl.' >&2; exit 1; }
  systemctl --user show-environment >/dev/null 2>&1 || { echo 'Headless setup requires a systemd user manager.' >&2; exit 1; }
fi
bin_dir="$HOME/.local/bin"
install_dir="$HOME/.local/lib/raphie"
updating=false
if [ -f "$install_dir/.raphie-user-install" ] && [ ! -L "$install_dir" ] && [ ! -L "$install_dir/.raphie-user-install" ] && [ -L "$bin_dir/raphie" ] && [ "$(readlink "$bin_dir/raphie")" = "$install_dir/raphie" ]; then
  updating=true
elif [ -e "$install_dir" ] || [ -L "$install_dir" ] || [ -e "$bin_dir/raphie" ] || [ -L "$bin_dir/raphie" ]; then
  echo 'An unmanaged installation or raphie command already exists; no files were changed.' >&2
  exit 1
fi
# Starting a new binary could migrate old databases. Never select existing data implicitly.
if [ "$platform" = Darwin ]; then
  data_dir="$HOME/Library/Application Support/Raphie"
else
  case "${XDG_DATA_HOME:-}" in
    /*) data_dir="$XDG_DATA_HOME/raphie" ;;
    *) data_dir="$HOME/.local/share/raphie" ;;
  esac
fi
if [ "$updating" = false ]; then
  if { [ "$platform" = Linux ] && { [ -e "$HOME/.config/systemd/user/raphie.service" ] || [ -L "$HOME/.config/systemd/user/raphie.service" ]; }; } ||
     { [ "$platform" = Darwin ] && { [ -e "$HOME/Library/LaunchAgents/com.raphie.user.plist" ] || [ -L "$HOME/Library/LaunchAgents/com.raphie.user.plist" ]; }; }; then
    echo 'An existing Raphie user service was found; no files were changed.' >&2; exit 1
  fi
fi
if [ "$updating" = true ]; then
  stored_data=$(cat "$install_dir/.data-directory")
  if [ "$stored_data" != "$data_dir" ]; then echo "Data directory changed; restore the original XDG_DATA_HOME and retry." >&2; exit 1; fi
  if [ -L "$data_dir" ] || { [ -e "$data_dir" ] && [ ! -d "$data_dir" ]; }; then echo 'Data directory must be a real directory; update stopped.' >&2; exit 1; fi
elif [ -e "$data_dir" ] || [ -L "$data_dir" ]; then
  echo "Existing Raphie data found at $data_dir; no files were changed. Migration requires a separate plan." >&2
  exit 1
fi
work=$(mktemp -d)
stage=
lock=
claimed=false
trap 'if [ "$claimed" = true ]; then rm -rf "$install_dir"; fi; [ -z "$lock" ] || rmdir "$lock" 2>/dev/null || true; [ -z "$stage" ] || rm -rf "$stage"; rm -rf "$work"' EXIT
mkdir -p "$HOME/.local/lib" "$bin_dir"
lock="$HOME/.local/lib/.raphie-install.lock"
if ! mkdir "$lock"; then lock=; echo 'Another Raphie installation or update is in progress.' >&2; exit 1; fi
channel=stable
if [ "$updating" = true ] && [ -e "$install_dir/.channel" ]; then
  channel=$(cat "$install_dir/.channel")
fi
case "$channel" in stable|nightly) ;; *) echo 'Invalid saved release channel; choose stable or nightly with raphie channel.' >&2; exit 1;; esac
if [ -n "$requested_channel" ]; then
  channel=$requested_channel
  if [ "$updating" = true ]; then
    # Persist an intentional switch even when no safe update exists yet.
    channel_tmp=$(mktemp "$install_dir/.channel.XXXXXXXX")
    printf '%s\n' "$channel" > "$channel_tmp"
    mv -f "$channel_tmp" "$install_dir/.channel"
    echo "Release channel set to $channel."
  fi
fi
api='https://api.github.com/repos/kalibetre/raphie/releases?per_page=100'
if [ "$channel" = stable ]; then
  # The latest stable may be older than 100 nightly releases.
  curl -fsSL 'https://api.github.com/repos/kalibetre/raphie/releases/latest' -o "$work/releases.json" 2>/dev/null || {
    if ! curl -fsSL "$api" -o "$work/releases.json"; then
      echo 'Could not fetch GitHub release metadata. Check connectivity or API rate limits and retry.' >&2; exit 1
    fi
  }
elif ! curl -fsSL "$api" -o "$work/releases.json"; then
  echo 'Could not fetch GitHub release metadata. Check connectivity or API rate limits and retry.' >&2; exit 1
fi
current_version=
if [ "$updating" = true ]; then
  current_version=$(cat "$install_dir/.raphie-user-install")
  case "$current_version" in *[!a-zA-Z0-9._-]*|'') echo 'Installed version is unknown; refusing to replace it automatically.' >&2; exit 1;; esac
fi
# Explicit file-backed headless mode. Desktop installs keep the OS credential store.
configure_headless() {
  [ "$platform" = Linux ] || { echo '--headless is supported on Linux only.' >&2; return 1; }
  systemctl --user show-environment >/dev/null 2>&1 || { echo 'Headless setup requires a systemd user manager.' >&2; return 1; }
  [ -f "$HOME/.config/systemd/user/raphie.service" ] && [ ! -L "$HOME/.config/systemd/user/raphie.service" ] || { echo 'A Raphie user service is required for headless setup.' >&2; return 1; }
  python3 - "$HOME" "$data_dir" <<'PY_HEADLESS'
import base64, json, os, re, sqlite3, stat, sys
home, data = sys.argv[1:]
private = os.path.join(home, '.local', 'share', 'raphie-headless')
key = os.path.join(private, 'master-key')
marker = os.path.join(private, 'configured')
dropdir = os.path.join(home, '.config', 'systemd', 'user', 'raphie.service.d')
dropin = os.path.join(dropdir, 'raphie-headless.conf')
if os.path.commonpath([os.path.realpath(private), os.path.realpath(data)]) == os.path.realpath(data):
    sys.exit('Headless key directory must be outside Raphie data.')
if any(os.path.islink(path) for path in (private, marker, key, dropdir, dropin)):
    sys.exit('Headless setup found an unsafe symbolic link; no key was replaced.')
if os.path.lexists(private):
    info = os.stat(private)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        sys.exit('Headless key directory must be owned by this user and have mode 0700.')
    if not os.path.isfile(marker) or not os.path.isfile(key):
        sys.exit('Existing headless directory is incomplete or uses the old keyring backend; no key was replaced. Migration requires a separate plan.')
    with open(marker, encoding='utf-8') as f:
        if f.read(64) != 'raphie-file-key-v1\n':
            sys.exit('Existing headless backend cannot be switched automatically; no key was replaced.')
    info = os.stat(key)
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or info.st_size != 45:
        sys.exit('Headless master key must be an owner-only regular file (0600).')
    with open(key, 'rb') as f:
        if not re.fullmatch(rb'[A-Za-z0-9+/]{43}=\n', f.read(46)):
            sys.exit('Headless master key is malformed; restore its backup. No key was replaced.')
else:
    if os.path.lexists(dropin): sys.exit('An existing headless service override was found; refusing to replace it.')
    dbpath = os.path.join(data, 'settings.sqlite')
    if os.path.exists(dbpath):
        try:
            db = sqlite3.connect('file:' + dbpath.replace('?', '%3f').replace('#', '%23') + '?mode=ro', uri=True)
            tables = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").fetchone()
            row = db.execute('SELECT value FROM settings WHERE id = 1').fetchone() if tables else None
            db.close()
            if row and json.loads(row[0]).get('keyId'):
                sys.exit('Existing encrypted settings use another credential store. Headless setup cannot migrate them automatically.')
        except (sqlite3.Error, ValueError, TypeError, AttributeError):
            sys.exit('Could not verify existing settings safely; headless setup stopped.')
    os.makedirs(os.path.dirname(private), mode=0o700, exist_ok=True)
    os.mkdir(private, 0o700)
    fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(base64.b64encode(os.urandom(32)) + b'\n')
        f.flush()
        os.fsync(f.fileno())
    with open(marker, 'x', encoding='utf-8') as f: f.write('raphie-file-key-v1\n')
    for directory in (private, os.path.dirname(private)):
        fd = os.open(directory, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
os.makedirs(dropdir, mode=0o700, exist_ok=True)
def quote(value): return value.replace('%', '%%').replace('\\', '\\\\').replace('"', '\\"')
with open(dropin, 'w', encoding='utf-8') as f:
    f.write('[Service]\nEnvironment="RAPHIE_CREDENTIAL_KEY_FILE=' + quote(key) + '"\n')
PY_HEADLESS
  echo 'Headless credential store configured. Protect and back up ~/.local/share/raphie-headless separately from Raphie data.'
  systemctl --user daemon-reload
  if command -v loginctl >/dev/null && loginctl --no-ask-password enable-linger "$(id -un)" >/dev/null 2>&1; then
    echo 'User lingering enabled for automatic startup after reboot.'
  else
    echo 'Could not enable user lingering. Automatic startup after reboot requires host authorization; run loginctl enable-linger for this user.' >&2
  fi
}

if version=$(python3 - "$work/releases.json" "$channel" "$asset" <<'PY_RELEASE'
import json, re, sys
with open(sys.argv[1], encoding='utf-8') as source: releases = json.load(source)
if isinstance(releases, dict): releases = [releases]
if not isinstance(releases, list): raise SystemExit('Invalid release list.')
def key(r):
    if not isinstance(r, dict) or r.get('draft') is not False: return None
    tag = r.get('tag_name')
    if not isinstance(tag, str): return None
    if not {sys.argv[3], 'SHA256SUMS'}.issubset({a.get('name') for a in (r.get('assets') or []) if isinstance(a, dict)}): return None
    if sys.argv[2] == 'stable':
        match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)', tag)
        if not match or r.get('prerelease') is not False: return None
    else:
        match = re.fullmatch(r'nightly-(\d+)-(\d+)', tag)
        if not match or r.get('prerelease') is not True: return None
    return tuple(map(int, match.groups()))
candidates = [(k, r['tag_name']) for r in releases if (k := key(r)) is not None]
if not candidates: raise SystemExit(42)
print(max(candidates)[1])
PY_RELEASE
); then :; else
  status=$?
  if [ "$status" = 42 ]; then
    echo "No $channel release is available for this platform."
    if [ "$updating" = true ]; then echo "The current installation remains unchanged; future updates will follow $channel."; exit 0; fi
  fi
  exit 1
fi
if [ -n "$current_version" ] && [ "$current_version" = "$version" ]; then
  if [ "$headless" = true ]; then
    systemctl --user stop raphie.service
    configure_headless
    systemctl --user enable raphie.service
    systemctl --user restart raphie.service
    ready=false
    for attempt in {1..15}; do
      if PORT=4316 RAPHIE_WEB_PORT=4320 "$install_dir/raphie" health >/dev/null 2>&1; then echo "User service is healthy."; ready=true; break; fi
      sleep 1
    done
    if [ "$ready" != true ]; then
      systemctl --user disable --now raphie.service || true
      echo "Service did not become healthy. Check: journalctl --user -u raphie -e" >&2
      exit 1
    fi
  fi

  echo "Already on $version ($channel channel)."
  exit 0
fi
if [ -n "$current_version" ]; then
  if ! curl -fsSL "https://api.github.com/repos/kalibetre/raphie/compare/$current_version...$version" -o "$work/compare.json"; then
    echo 'Could not verify update ancestry. The current installation remains unchanged.' >&2; exit 1
  fi
  if ! python3 - "$work/compare.json" <<'PY_COMPARE'
import json, sys
with open(sys.argv[1], encoding='utf-8') as source: comparison = json.load(source)
if comparison.get('status') not in ('ahead', 'identical'): sys.exit(1)
PY_COMPARE
  then
    echo "No safe $channel update is available yet. The current installation remains unchanged; future updates will follow $channel."
    exit 0
  fi
fi
if ! curl -fsSL "https://github.com/kalibetre/raphie/releases/download/$version/$asset" -o "$work/release.tar.gz"; then
  echo "Could not download $asset for $version." >&2; exit 1
fi
if ! curl -fsSL "https://github.com/kalibetre/raphie/releases/download/$version/SHA256SUMS" -o "$work/SHA256SUMS"; then
  echo "Could not download release checksums for $version." >&2; exit 1
fi
python3 - "$work/release.tar.gz" "$work/SHA256SUMS" "$asset" <<'PY_HASH'
import hashlib, re, sys
with open(sys.argv[2], encoding='ascii') as source: lines = source.read().splitlines()
matches = [m.group(1).lower() for line in lines if (m := re.fullmatch(r'([a-fA-F0-9]{64}) [ *](.+)', line)) and m.group(2) == sys.argv[3]]
if len(matches) != 1: raise SystemExit('Release checksum is missing or ambiguous.')
h = hashlib.sha256()
with open(sys.argv[1], 'rb') as source:
    for block in iter(lambda: source.read(1024 * 1024), b''): h.update(block)
if h.hexdigest() != matches[0]: raise SystemExit('Release checksum does not match; installation stopped.')
PY_HASH
mkdir "$work/bundle"
python3 - "$work/release.tar.gz" "$work/bundle" <<'PY'
import os, re, shutil, sys, tarfile
required = {'raphie', 'raphie-runtime', 'raphie-web'}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    names = [m.name for m in members]
    if (len(names) > 64 or len(names) != len(set(names)) or not required.issubset(names)
        or any(not m.isfile() or m.size > 500_000_000 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', m.name) for m in members)):
        raise SystemExit('Invalid release archive contents.')
    for member in members:
        if member.name not in required: continue
        with archive.extractfile(member) as source, open(os.path.join(sys.argv[2], member.name), 'xb') as target:
            shutil.copyfileobj(source, target)
        os.chmod(os.path.join(sys.argv[2], member.name), 0o755)
PY
if [ "$updating" = true ]; then
  if [ "$platform" = Linux ] && [ -f "$HOME/.config/systemd/user/raphie.service" ]; then
    systemctl --user stop raphie.service || { echo 'Could not stop the user service; no update was performed.' >&2; exit 1; }
  elif [ "$platform" = Darwin ] && launchctl print "gui/$(id -u)/com.raphie.user" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.raphie.user.plist" || { echo 'Could not stop the user service; no update was performed.' >&2; exit 1; }
  fi
fi
# A foreground or another installation may still hold either port. Never copy a live database.
if ! python3 - <<'PY_PORT'
import socket, sys
sockets = []
try:
    for port in (4316, 4320):
        sock = socket.socket(); sockets.append(sock); sock.bind(('127.0.0.1', port))
except OSError:
    sys.exit('Raphie ports are in use. Stop the other process and retry; no data was changed.')
finally:
    for sock in sockets: sock.close()
PY_PORT
then exit 1; fi
if [ "$updating" = true ] && [ -d "$data_dir" ]; then
  backup_root="$HOME/.local/share/raphie-backups"
  mkdir -p -m 700 "$backup_root"
  backup=$(mktemp -d "$backup_root/update.XXXXXXXX")
  cp -a "$data_dir" "$backup/data" || { echo "Backup failed at $backup; update stopped." >&2; exit 1; }
  echo "Offline data backup: $backup/data (the credential key must be backed up separately)."
fi
stage=$(mktemp -d "$HOME/.local/lib/.raphie-stage.XXXXXXXX")
cp "$work/bundle/raphie" "$work/bundle/raphie-runtime" "$work/bundle/raphie-web" "$stage/"
printf '%s\n' "$version" > "$stage/.raphie-user-install"
printf '%s\n' "$data_dir" > "$stage/.data-directory"
printf '%s\n' "$channel" > "$stage/.channel"
if [ "$updating" = true ]; then
  old=$(mktemp -d "$HOME/.local/lib/.raphie-previous.XXXXXXXX")
  rmdir "$old"
  mv "$install_dir" "$old"
  if ! mv "$stage" "$install_dir"; then mv "$old" "$install_dir"; echo 'Update failed before startup; previous binaries restored.' >&2; exit 1; fi
  echo "Previous binaries retained at $old."
else
  # mkdir is the atomic claim against another installation.
  mkdir -m 700 "$install_dir" || { echo 'Installation directory already exists.' >&2; exit 1; }
  claimed=true
  cp "$stage/"* "$install_dir/"
  cp "$stage/.raphie-user-install" "$stage/.data-directory" "$stage/.channel" "$install_dir/"
  if ! ln -s "$install_dir/raphie" "$bin_dir/raphie"; then
    echo "Could not create $bin_dir/raphie; installation was not completed." >&2; exit 1
  fi
  claimed=false
fi
printf '\nInstalled Raphie %s (%s channel).\n' "$version" "$channel"
case ":$PATH:" in *":$bin_dir:"*) ;; *) printf 'Add %s to your PATH (for bash/zsh: export PATH="$HOME/.local/bin:$PATH").\n' "$bin_dir" ;; esac
service_started=false
service_attempted=false
case "$(uname -s)" in
  Linux)
    unit_dir="$HOME/.config/systemd/user"
    unit="$unit_dir/raphie.service"
    if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1 && [ ! -e "$unit" ] && [ ! -L "$unit" ]; then
      mkdir -p "$unit_dir"
      python3 - "$install_dir/raphie" "$unit" "$data_dir" <<'PY_SERVICE'
import sys
# systemd unit values are not shell commands. Escape specifiers and quotes.
def quote(value): return value.replace('%', '%%').replace('$', '$$').replace('\\', '\\\\').replace('"', '\\"')
exe = quote(sys.argv[1])
data = quote(sys.argv[3])
with open(sys.argv[2], 'x', encoding='utf-8') as unit:
    unit.write('[Unit]\nDescription=Raphie assistant\n\n[Service]\nEnvironment=PORT=4316 RAPHIE_WEB_PORT=4320 RAPHIE_RUNTIME_URL=http://127.0.0.1:4316 RAPHIE_WEB_ORIGIN=http://127.0.0.1:4320\nExecStart="' + exe + '" start --data-dir "' + data + '"\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n')
PY_SERVICE
      service_attempted=true
      if [ "$headless" = true ]; then configure_headless; fi
      if systemctl --user daemon-reload && systemctl --user enable --now raphie.service; then service_started=true; fi
    elif [ "$updating" = true ] && [ -f "$unit" ]; then
      service_attempted=true
      if [ "$headless" = true ]; then configure_headless; fi
      if systemctl --user enable --now raphie.service; then service_started=true; fi
    fi ;;
  Darwin)
    agent_dir="$HOME/Library/LaunchAgents"
    agent="$agent_dir/com.raphie.user.plist"
    if command -v launchctl >/dev/null && [ ! -e "$agent" ] && [ ! -L "$agent" ]; then
      mkdir -p "$agent_dir" "$HOME/Library/Logs/Raphie"
      python3 - "$install_dir/raphie" "$agent" "$HOME/Library/Logs/Raphie" "$data_dir" <<'PY_SERVICE'
import os, plistlib, sys
payload = {'Label': 'com.raphie.user', 'ProgramArguments': [sys.argv[1], 'start', '--data-dir', sys.argv[4]], 'EnvironmentVariables': {'PORT': '4316', 'RAPHIE_WEB_PORT': '4320', 'RAPHIE_RUNTIME_URL': 'http://127.0.0.1:4316', 'RAPHIE_WEB_ORIGIN': 'http://127.0.0.1:4320'}, 'RunAtLoad': True, 'KeepAlive': {'SuccessfulExit': False}, 'StandardOutPath': os.path.join(sys.argv[3], 'service.log'), 'StandardErrorPath': os.path.join(sys.argv[3], 'service-error.log')}
with open(sys.argv[2], 'xb') as out: plistlib.dump(payload, out)
PY_SERVICE
      service_attempted=true
      if launchctl bootstrap "gui/$(id -u)" "$agent"; then service_started=true; fi
    elif [ "$updating" = true ] && [ -f "$agent" ]; then
      service_attempted=true
      if launchctl enable "gui/$(id -u)/com.raphie.user" && launchctl bootstrap "gui/$(id -u)" "$agent"; then service_started=true; fi
    fi ;;
esac
service_failed=false
if [ "$service_started" = true ]; then
  ready=false
  for attempt in {1..15}; do
    if PORT=4316 RAPHIE_WEB_PORT=4320 "$install_dir/raphie" health >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  if [ "$ready" = true ]; then
    printf 'User service is healthy.\n'
  else
    if [ "$platform" = Linux ]; then systemctl --user disable --now raphie.service || true; printf 'Service did not become healthy. Check: journalctl --user -u raphie -e\n' >&2
    else launchctl bootout "gui/$(id -u)" "$agent" || true; launchctl disable "gui/$(id -u)/com.raphie.user" || true; printf 'Service did not become healthy. Check: %s\n' "$HOME/Library/Logs/Raphie/service-error.log" >&2; fi
    service_failed=true
    echo 'The service was stopped. Check the credential store or configured headless key file, and check for port conflicts before starting it again.' >&2
    [ "$updating" = false ] || echo 'Do not start an older version against migrated data; restore the offline backup first.' >&2
  fi
elif [ "$service_attempted" = true ]; then
  service_failed=true
  if [ "$platform" = Linux ]; then systemctl --user disable --now raphie.service || true; echo 'Service could not start. Check: journalctl --user -u raphie -e' >&2
  else launchctl bootout "gui/$(id -u)" "$agent" 2>/dev/null || true; echo "Service could not start. Check: $HOME/Library/Logs/Raphie/service-error.log" >&2; fi
else
  printf 'User service was not started. Run %s start in a terminal.\n' "$bin_dir/raphie"
fi
printf 'Run "%s" auth setup --data-dir "%s", then open http://127.0.0.1:4320.\n' "$bin_dir/raphie" "$data_dir"
printf 'Desktop mode needs an available OS credential store; headless mode needs its preserved master-key file.\n'
[ "$service_failed" = false ] || return 1
}
main "$@"
