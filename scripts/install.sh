#!/usr/bin/env bash
# Install Raphie for the current user. No system files or packages are changed.
set -euo pipefail
main() {

requested_channel=
requested_web_port=
requested_runtime_port=
headless=false
modify_path=true
while [ "$#" -gt 0 ]; do
  case "$1" in
    --headless) headless=true; shift ;;
    --no-modify-path) modify_path=false; shift ;;
    --port) [ "$#" -ge 2 ] || { echo "Usage: bash install.sh [--channel stable|nightly] [--port WEB_PORT] [--runtime-port PORT] [--headless] [--no-modify-path]" >&2; exit 1; }; requested_web_port=$2; shift 2 ;;
    --runtime-port) [ "$#" -ge 2 ] || { echo "Usage: bash install.sh [--channel stable|nightly] [--port WEB_PORT] [--runtime-port PORT] [--headless] [--no-modify-path]" >&2; exit 1; }; requested_runtime_port=$2; shift 2 ;;
    --channel) [ "$#" -ge 2 ] || { echo 'Usage: bash install.sh [--channel stable|nightly] [--port WEB_PORT] [--runtime-port PORT] [--headless] [--no-modify-path]' >&2; exit 1; }; [ -z "$requested_channel" ] || { echo 'Specify one channel.' >&2; exit 1; }; requested_channel=$2; shift 2 ;;
    *) echo 'Usage: bash install.sh [--channel stable|nightly] [--port WEB_PORT] [--runtime-port PORT] [--headless] [--no-modify-path]' >&2; exit 1 ;;
  esac
done
case "$requested_channel" in ''|stable|nightly) ;; *) echo 'Choose either stable or nightly.' >&2; exit 1;; esac
for value in "$requested_web_port" "$requested_runtime_port"; do
  case "$value" in '') ;; *[!0-9]*) echo 'Ports must be numbers from 1024 to 65535.' >&2; exit 1 ;;
    *) if [ "${#value}" -gt 5 ] || [ "$value" -lt 1024 ] || [ "$value" -gt 65535 ]; then echo 'Ports must be numbers from 1024 to 65535.' >&2; exit 1; fi ;;
  esac
done
configure_path() {
  if [ "$modify_path" = true ]; then
    python3 - "$HOME" "${SHELL:-}" "${ZDOTDIR:-$HOME}" <<'PY_PATH'
import os, pathlib, pwd, stat, sys
home = pathlib.Path(sys.argv[1]).resolve()
shell = pathlib.Path(sys.argv[2] or pwd.getpwuid(os.getuid()).pw_shell).name
begin, end = '# >>> Raphie PATH >>>', '# <<< Raphie PATH <<<'
block = begin + '''
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
''' + end + '\n'
if shell == 'bash':
    login = next((home / name for name in ('.bash_profile', '.bash_login', '.profile') if (home / name).exists()), home / '.profile')
    files = [home / '.bashrc', login]
elif shell == 'zsh':
    directory = pathlib.Path(sys.argv[3])
    files = [directory / '.zshrc', directory / '.zprofile']
else:
    files = []
    print('Shell PATH setup is automatic for Bash and Zsh; configure ~/.local/bin for your shell.')
for path in files:
    try:
        target = path.resolve()
        if home not in target.parents: raise ValueError()
        if target.exists():
            info = target.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid(): raise ValueError()
        content = target.read_text() if target.exists() else ''
        if begin in content:
            if end not in content: raise ValueError()
            continue
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(target, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as out:
            out.write(('\n' if content and not content.endswith('\n') else '') + '\n' + block)
        print('Configured Raphie PATH in ' + str(path) + ' (applies to new terminals).')
    except (OSError, ValueError, RuntimeError):
        print('Could not safely configure ' + str(path) + '; add ~/.local/bin to PATH manually.', file=sys.stderr)
PY_PATH
  fi
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) printf 'For this Bash/Zsh session, run: export PATH="$HOME/.local/bin:$PATH"\n' ;;
  esac
}
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
  Darwin:x86_64) echo 'Raphie supports Apple Silicon Macs only; Intel Macs are not supported.' >&2; exit 1 ;;
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
trap 'kill $(jobs -p) 2>/dev/null || true; if [ "$claimed" = true ]; then rm -rf "$install_dir"; fi; [ -z "$lock" ] || rmdir "$lock" 2>/dev/null || true; [ -z "$stage" ] || rm -rf "$stage"; rm -rf "$work"' EXIT
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
# New installations get high, uncommon ports; an existing one keeps its own.
# Installations from before ports were saved used 4316 and 4320.
if [ "$updating" = true ]; then
  if [ -n "$requested_web_port$requested_runtime_port" ]; then
    echo 'Raphie is already installed. Change its ports with: raphie set-port WEB_PORT [--runtime PORT]' >&2; exit 1
  fi
  if [ -f "$install_dir/.ports" ]; then
    runtime_port=$(sed -n 's/^runtime=//p' "$install_dir/.ports")
    web_port=$(sed -n 's/^web=//p' "$install_dir/.ports")
  else
    runtime_port=4316; web_port=4320
  fi
else
  runtime_port=${requested_runtime_port:-24316}
  web_port=${requested_web_port:-24320}
fi
case "$runtime_port:$web_port" in *[!0-9:]*|:*|*:) echo "Saved ports in $install_dir/.ports are not valid. Fix them with raphie set-port." >&2; exit 1 ;; esac
if [ "$runtime_port" = "$web_port" ]; then echo 'The web and runtime ports must differ.' >&2; exit 1; fi
api='https://api.github.com/repos/kalibetre/raphie/releases?per_page=100'
# Large downloads show curl's meter (size, speed, time left) in a terminal;
# logs and pipes get the quiet form.
if [ -t 2 ]; then fetch=-fSL; else fetch=-fsSL; fi
# Downloads release file $1 to $2. A release's files never change, so a
# download that breaks off resumes where it stopped instead of starting
# over: on a slow link the archive takes a long time.
download() {
  local attempt=1 status
  while :; do
    status=0
    curl "$fetch" "$1" -o "$2" -C - || status=$?
    [ "$status" = 0 ] && return 0
    # 33: the server cannot resume, so the next attempt starts over.
    [ "$status" != 33 ] || rm -f "$2"
    [ "$attempt" -lt 5 ] || return 1
    attempt=$((attempt + 1))
    printf 'The download broke off at %s MB; resuming (attempt %s of 5)...\n' \
      "$(python3 -c 'import os, sys; print(f"{os.path.getsize(sys.argv[1]) / 1e6:.1f}" if os.path.exists(sys.argv[1]) else "0.0")' "$2")" "$attempt"
    sleep $((attempt * 2))
  done
}
# Downloads byte range $3-$4 of $1 to $2, resuming where a broken attempt
# stopped. Returns 2 when the server answers with the whole file instead of
# the range, so the caller can fall back to one stream.
download_part() {
  local want=$(($4 - $3 + 1)) attempt=1 have
  : > "$2"
  while :; do
    have=$(($(wc -c < "$2")))
    [ "$have" -lt "$want" ] || break
    if [ "$attempt" -gt 1 ]; then
      [ "$attempt" -le 5 ] || return 1
      sleep $((attempt * 2))
    fi
    rm -f "$2.headers"
    curl -fsSL -r "$(($3 + have))-$4" -D "$2.headers" "$1" >> "$2" || true
    if grep -q '^HTTP/[0-9.]* 200' "$2.headers" 2>/dev/null && ! grep -q '^HTTP/[0-9.]* 206' "$2.headers"; then return 2; fi
    attempt=$((attempt + 1))
  done
  [ "$have" = "$want" ]
}
megabytes() { awk -v bytes="$1" 'BEGIN { printf "%.1f", bytes / 1e6 }'; }
# Downloads release file $1 of $3 bytes to $2 as 16 parts at once. On
# some networks GitHub's download server is slow per connection while the
# link has room to spare, so parts in parallel arrive several times faster
# than one stream. Small or unsized files, and a server that ignores
# ranges, take one stream.
download_parallel() {
  local parts=16 size=$3 chunk i start end got failed=0 status pid began=$SECONDS
  local -a pids=()
  case "$size" in '' | *[!0-9]*) download "$1" "$2"; return ;; esac
  if [ "$size" -lt 8388608 ]; then download "$1" "$2"; return; fi
  chunk=$(((size + parts - 1) / parts))
  mkdir "$2.parts"
  for ((i = 0; i < parts; i++)); do
    start=$((i * chunk)); end=$((start + chunk - 1))
    [ "$end" -lt "$size" ] || end=$((size - 1))
    download_part "$1" "$2.parts/$i" "$start" "$end" &
    pids+=($!)
  done
  # curl's own meter would draw once per part, so count the parts instead.
  if [ -t 2 ]; then
    while [ -n "$(jobs -rp)" ]; do
      got=0
      for ((i = 0; i < parts; i++)); do got=$((got + $(wc -c < "$2.parts/$i" 2>/dev/null || echo 0))); done
      printf '\r%s of %s MB, %s KB/s, in %s parts at once ' "$(megabytes "$got")" "$(megabytes "$size")" \
        "$((got / 1000 / (SECONDS - began + 1)))" "$parts" >&2
      sleep 1
    done
    printf '\n' >&2
  fi
  for pid in "${pids[@]}"; do
    status=0
    wait "$pid" || status=$?
    [ "$status" = 0 ] || [ "$failed" = 2 ] || failed=$status
  done
  if [ "$failed" = 0 ]; then
    for ((i = 0; i < parts; i++)); do cat "$2.parts/$i"; done > "$2"
    rm -rf "$2.parts"
    return 0
  fi
  rm -rf "$2.parts"
  [ "$failed" = 2 ] || return 1
  echo 'The server does not send the file in parts; downloading it in one stream...'
  download "$1" "$2"
}
echo "Finding the newest $channel release..."
if [ "$channel" = stable ]; then
  # The latest stable may be older than 100 nightly releases.
  curl -fsSL 'https://api.github.com/repos/kalibetre/raphie/releases/latest' -o "$work/releases.json" 2>/dev/null || {
    if ! curl "$fetch" "$api" -o "$work/releases.json"; then
      echo 'Could not fetch GitHub release metadata. Check connectivity or API rate limits and retry.' >&2; exit 1
    fi
  }
elif ! curl "$fetch" "$api" -o "$work/releases.json"; then
  echo 'Could not fetch GitHub release metadata. Check connectivity or API rate limits and retry.' >&2; exit 1
fi
current_version=
if [ "$updating" = true ]; then
  current_version=$(cat "$install_dir/.raphie-user-install")
  case "$current_version" in *[!a-zA-Z0-9._-]*|'') echo 'Installed version is unknown; refusing to replace it automatically.' >&2; exit 1;; esac
  configure_path
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
        if r.get('prerelease') is not True: return None
        match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)\.(\d+)', tag)
        if match: return (1, *map(int, match.groups()[3:]))
        match = re.fullmatch(r'nightly-(\d+)-(\d+)', tag)
        if not match: return None
        return (0, *map(int, match.groups()))
    return tuple(map(int, match.groups()))
def size(r):
    found = [a.get('size') for a in r['assets'] if isinstance(a, dict) and a.get('name') == sys.argv[3]]
    return found[0] if found and type(found[0]) is int and found[0] > 0 else '-'
candidates = [(k, r['tag_name'], size(r)) for r in releases if (k := key(r)) is not None]
if not candidates: raise SystemExit(42)
print('%s %s' % max(candidates)[1:])
PY_RELEASE
); then :; else
  status=$?
  if [ "$status" = 42 ]; then
    echo "No $channel release is available for this platform."
    if [ "$updating" = true ]; then echo "The current installation remains unchanged; future updates will follow $channel."; exit 0; fi
  fi
  exit 1
fi
# The archive's size in bytes, or - when the release does not say.
asset_bytes=${version#* }
version=${version%% *}
if [ -n "$current_version" ] && [ "$current_version" = "$version" ]; then
  if [ "$headless" = true ]; then
    systemctl --user stop raphie.service
    configure_headless
    systemctl --user enable raphie.service
    systemctl --user restart raphie.service
    ready=false
    for attempt in {1..15}; do
      if "$install_dir/raphie" health >/dev/null 2>&1; then echo "User service is healthy."; ready=true; break; fi
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
  # Only the status is needed. GitHub lists the changed files on the first
  # page of a comparison only, and those diffs can run to megabytes, so ask
  # for the second page of one commit each.
  echo "Checking that $version follows the installed $current_version..."
  if ! curl -fsSL "https://api.github.com/repos/kalibetre/raphie/compare/$current_version...$version?per_page=1&page=2" -o "$work/compare.json" --retry 3; then
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
if [ "$asset_bytes" = - ]; then asset_size='size unknown'; else asset_size="$(megabytes "$asset_bytes") MB"; fi
echo "Downloading $asset for $version ($asset_size)..."
if ! download_parallel "https://github.com/kalibetre/raphie/releases/download/$version/$asset" "$work/release.tar.gz" "$asset_bytes"; then
  echo "Could not download $asset for $version." >&2; exit 1
fi
if ! fetch=-fsSL download "https://github.com/kalibetre/raphie/releases/download/$version/SHA256SUMS" "$work/SHA256SUMS"; then
  echo "Could not download release checksums for $version." >&2; exit 1
fi
echo 'Verifying the download...'
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
# A release is one executable; one from before that also has the runtime
# and web host as their own executables, which it then needs.
required = {'raphie'}
wanted = required | {'raphie-runtime', 'raphie-web'}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    names = [m.name for m in members]
    if (len(names) > 64 or len(names) != len(set(names)) or not required.issubset(names)
        or any(not m.isfile() or m.size > 500_000_000 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', m.name) for m in members)):
        raise SystemExit('Invalid release archive contents.')
    for member in members:
        if member.name not in wanted: continue
        with archive.extractfile(member) as source, open(os.path.join(sys.argv[2], member.name), 'xb') as target:
            shutil.copyfileobj(source, target)
        os.chmod(os.path.join(sys.argv[2], member.name), 0o755)
PY
stopped_service=
if [ "$updating" = true ]; then
  echo 'Stopping Raphie to update it...'
  if [ "$platform" = Linux ] && [ -f "$HOME/.config/systemd/user/raphie.service" ]; then
    systemctl --user stop raphie.service || { echo 'Could not stop the user service; no update was performed.' >&2; exit 1; }
    stopped_service=systemd
  elif [ "$platform" = Darwin ] && launchctl print "gui/$(id -u)/com.raphie.user" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.raphie.user.plist" || { echo 'Could not stop the user service; no update was performed.' >&2; exit 1; }
    stopped_service=launchd
  fi
fi
# A foreground or another installation may still hold either port. Never copy a live database.
# launchctl bootout returns before the service has exited, so an update
# waits for the ports to free up before giving up.
if ! python3 - "$runtime_port" "$web_port" "$updating" <<'PY_PORT'
import socket, sys, time
runtime, web, updating = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3] == 'true'
deadline = time.monotonic() + (30 if updating else 0)
for port in (runtime, web):
    while True:
        sock = socket.socket()
        try:
            sock.bind(('127.0.0.1', port))
            break
        except OSError:
            if time.monotonic() < deadline:
                time.sleep(0.25)
                continue
            if updating:
                sys.exit(f'Port {port} is in use. Stop the other Raphie or process holding it and retry; no data was changed.')
            flag = '--runtime-port' if port == runtime else '--port'
            sys.exit(f'Port {port} is in use by another program; nothing was installed. Run the installer again with a free port, for example:\n  curl -fsSL https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh | bash -s -- {flag} {port + 100}')
        finally:
            sock.close()
PY_PORT
then
  # Leave the installed Raphie running as it was found.
  case "$stopped_service" in
    systemd) systemctl --user start raphie.service || true ;;
    launchd) launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.raphie.user.plist" || true ;;
  esac
  exit 1
fi
if [ "$updating" = true ] && [ -d "$data_dir" ]; then
  backup_root="$HOME/.local/share/raphie-backups"
  mkdir -p -m 700 "$backup_root"
  backup=$(mktemp -d "$backup_root/update.XXXXXXXX")
  cp -a "$data_dir" "$backup/data" || { echo "Backup failed at $backup; update stopped." >&2; exit 1; }
  echo "Offline data backup: $backup/data (the credential key must be backed up separately)."
fi
stage=$(mktemp -d "$HOME/.local/lib/.raphie-stage.XXXXXXXX")
cp "$work/bundle/"* "$stage/"
printf '%s\n' "$version" > "$stage/.raphie-user-install"
printf '%s\n' "$data_dir" > "$stage/.data-directory"
printf '%s\n' "$channel" > "$stage/.channel"
printf 'runtime=%s\nweb=%s\n' "$runtime_port" "$web_port" > "$stage/.ports"
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
  cp "$stage/.raphie-user-install" "$stage/.data-directory" "$stage/.channel" "$stage/.ports" "$install_dir/"
  if ! ln -s "$install_dir/raphie" "$bin_dir/raphie"; then
    echo "Could not create $bin_dir/raphie; installation was not completed." >&2; exit 1
  fi
  claimed=false
fi
printf '\nInstalled Raphie %s (%s channel).\n' "$version" "$channel"
if [ "$updating" = false ]; then configure_path; fi
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
    # Ports are read from the installation's .ports by raphie start.
    unit.write('[Unit]\nDescription=Raphie assistant\n\n[Service]\nExecStart="' + exe + '" start --data-dir "' + data + '"\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n')
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
payload = {'Label': 'com.raphie.user', 'ProgramArguments': [sys.argv[1], 'start', '--data-dir', sys.argv[4]], 'RunAtLoad': True, 'KeepAlive': {'SuccessfulExit': False}, 'StandardOutPath': os.path.join(sys.argv[3], 'service.log'), 'StandardErrorPath': os.path.join(sys.argv[3], 'service-error.log')}
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
  echo 'Waiting for Raphie to start...'
  ready=false
  for attempt in {1..15}; do
    if "$install_dir/raphie" health >/dev/null 2>&1; then ready=true; break; fi
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
printf 'Run "%s" auth setup --data-dir "%s", then open http://127.0.0.1:%s.\n' "$bin_dir/raphie" "$data_dir" "$web_port"
printf 'Raphie listens on port %s (web) and %s (runtime). Change them with: raphie set-port WEB_PORT [--runtime PORT]\n' "$web_port" "$runtime_port"
printf 'Desktop mode needs an available OS credential store; headless mode needs its preserved master-key file.\n'
[ "$service_failed" = false ] || return 1
}
main "$@"
