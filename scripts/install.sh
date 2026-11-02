#!/usr/bin/env bash
# Install Raphie for the current user. No system files or packages are changed.
set -euo pipefail

version=${1:-}
if [ "$#" -gt 1 ] || { [ -n "$version" ] && [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-alpha\.[0-9]+)?$ ]]; }; then
  echo 'Usage: bash install.sh [vX.Y.Z[-alpha.N]]' >&2
  exit 1
fi
for command in curl python3; do
  command -v "$command" >/dev/null || { echo "Raphie needs $command; install it and retry." >&2; exit 1; }
done
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) platform=Linux; asset=raphie-linux-x64.tar.gz ;;
  Linux:aarch64|Linux:arm64) platform=Linux; asset=raphie-linux-arm64.tar.gz ;;
  Darwin:arm64) platform=Darwin; asset=raphie-darwin-arm64.tar.gz ;;
  Darwin:x86_64) platform=Darwin; asset=raphie-darwin-x64.tar.gz ;;
  *) echo 'This platform is not supported by the Raphie installer.' >&2; exit 1 ;;
esac
bin_dir="$HOME/.local/bin"
install_dir="$HOME/.local/lib/raphie"
if [ -e "$install_dir" ] || [ -L "$install_dir" ] || [ -e "$bin_dir/raphie" ] || [ -L "$bin_dir/raphie" ]; then
  echo 'A user installation or raphie command already exists; no files were changed.' >&2
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
if [ -e "$data_dir" ] || [ -L "$data_dir" ]; then
  echo "Existing Raphie data found at $data_dir; no files were changed. Migration requires a separate plan." >&2
  exit 1
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if [ -n "$version" ]; then
  api="https://api.github.com/repos/kalibetre/raphie/releases/tags/$version"
else
  api='https://api.github.com/repos/kalibetre/raphie/releases?per_page=100'
fi
curl -fsSL "$api" -o "$work/releases.json"
version=$(python3 - "$work/releases.json" "$version" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding='utf-8') as source: releases = json.load(source)
if not isinstance(releases, list): releases = [releases]
def usable(r):
    tag = r.get('tag_name')
    return (isinstance(tag, str) and re.fullmatch(r'v\d+\.\d+\.\d+(?:-alpha\.\d+)?', tag)
            and r.get('draft') is False and r.get('prerelease') is ('-alpha.' in tag))
valid = [r for r in releases if isinstance(r, dict) and usable(r)]
if sys.argv[2]: valid = [r for r in valid if r['tag_name'] == sys.argv[2]]
else: valid = [r for r in valid if not r['prerelease']] or valid
if not valid: raise SystemExit('No matching published Raphie release was found.')
print(valid[0]['tag_name'])
PY
)
curl -fsSL "https://github.com/kalibetre/raphie/releases/download/$version/$asset" -o "$work/release.tar.gz"
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
mkdir -p "$HOME/.local/lib" "$bin_dir"
# mkdir provides an atomic claim: a concurrent install cannot overwrite another.
mkdir -m 700 "$install_dir" || { echo 'Installation directory already exists.' >&2; exit 1; }
if ! cp "$work/bundle/raphie" "$work/bundle/raphie-runtime" "$work/bundle/raphie-web" "$install_dir/"; then
  echo "Installation incomplete at $install_dir; inspect it before retrying." >&2; exit 1
fi
# Do not overwrite another command even if it appeared during the download.
if ! ln -s "$install_dir/raphie" "$bin_dir/raphie"; then
  echo "Could not create $bin_dir/raphie; files remain at $install_dir." >&2; exit 1
fi
printf '\nInstalled Raphie %s.\n' "$version"
printf 'Add %s to your PATH if needed.\n' "$bin_dir"
service_started=false
case "$(uname -s)" in
  Linux)
    unit_dir="$HOME/.config/systemd/user"
    unit="$unit_dir/raphie.service"
    if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1 && [ ! -e "$unit" ] && [ ! -L "$unit" ]; then
      mkdir -p "$unit_dir"
      python3 - "$install_dir/raphie" "$unit" "$data_dir" <<'PY_SERVICE'
import sys
# systemd unit values are not shell commands. Escape specifiers and quotes.
def quote(value): return value.replace('%', '%%').replace('\\', '\\\\').replace('"', '\\"')
exe = quote(sys.argv[1])
data = quote(sys.argv[3])
with open(sys.argv[2], 'x', encoding='utf-8') as unit:
    unit.write('[Unit]\nDescription=Raphie assistant\n\n[Service]\nExecStart="' + exe + '" start --data-dir "' + data + '"\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n')
PY_SERVICE
      if systemctl --user daemon-reload && systemctl --user enable --now raphie.service; then service_started=true; fi
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
      if launchctl bootstrap "gui/$(id -u)" "$agent"; then service_started=true; fi
    fi ;;
esac
if [ "$service_started" = true ]; then
  printf 'User service installed.\n'
else
  printf 'User service was not started. Run raphie start in a terminal.\n'
fi
printf 'Run raphie auth setup in a terminal, then open http://127.0.0.1:4320.\n'
printf 'Raphie needs an available OS credential store.\n'
