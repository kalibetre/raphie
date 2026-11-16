#!/bin/sh
set -eu

# Fetch public releases from GitHub. Alpha releases must be selected explicitly;
# the default remains the latest stable release.
destination=${1:?Destination directory required}
requested=${2:-}
test "$#" -le 2 || { echo 'Expected destination and optional version.' >&2; exit 1; }
for command in curl python3; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
case "$(uname -m)" in
  x86_64) asset=raphie-linux-x64.tar.gz ;;
  aarch64|arm64) asset=raphie-linux-arm64.tar.gz ;;
  *) echo 'Unsupported Linux architecture.' >&2; exit 1 ;;
esac
if [ -n "$requested" ]; then
  printf '%s' "$requested" | python3 -c 'import re,sys; re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-alpha\.[0-9]+)?", sys.stdin.read()) or sys.exit("Expected a version such as v1.2.3 or v1.2.3-alpha.1.")'
  url="https://api.github.com/repos/kalibetre/raphie/releases/tags/$requested"
else
  url=https://api.github.com/repos/kalibetre/raphie/releases/latest
fi
test -d "$destination" && test -z "$(ls -A "$destination")" || { echo 'Destination must be an empty directory.' >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl -fsSL "$url" -o "$tmp/release.json"
tag=$(python3 - "$tmp/release.json" "$requested" <<'PY'
import json, re, sys
with open(sys.argv[1]) as f: release = json.load(f)
tag = release.get('tag_name', '')
if not isinstance(tag, str) or not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-alpha\.[0-9]+)?', tag):
    raise SystemExit('No matching Raphie release is available.')
alpha = '-alpha.' in tag
if release.get('draft') is not False or release.get('prerelease') is not alpha or (sys.argv[2] and tag != sys.argv[2]) or (not sys.argv[2] and alpha):
    raise SystemExit('No matching Raphie release is available.')
print(tag)
PY
)
curl -fsSL "https://github.com/kalibetre/raphie/releases/download/$tag/$asset" -o "$tmp/$asset"
# The archive must match the release's published checksum before anything in
# it is unpacked or run. This catches corrupted or swapped downloads; it does
# not prove who built the release (see the docs for `gh attestation verify`).
curl -fsSL "https://github.com/kalibetre/raphie/releases/download/$tag/SHA256SUMS" -o "$tmp/SHA256SUMS" || { echo "Could not download release checksums for $tag." >&2; exit 1; }
python3 - "$tmp/$asset" "$tmp/SHA256SUMS" "$asset" <<'PY'
import hashlib, re, sys
with open(sys.argv[2], encoding='ascii') as source: lines = source.read().splitlines()
matches = [m.group(1).lower() for line in lines if (m := re.fullmatch(r'([a-fA-F0-9]{64}) [ *](.+)', line)) and m.group(2) == sys.argv[3]]
if len(matches) != 1: raise SystemExit('Release checksum is missing or ambiguous.')
digest = hashlib.sha256()
with open(sys.argv[1], 'rb') as source:
    for block in iter(lambda: source.read(1024 * 1024), b''): digest.update(block)
if digest.hexdigest() != matches[0]: raise SystemExit('Release checksum does not match; nothing was installed.')
PY
python3 - "$tmp/$asset" "$destination" <<'PY'
import os, re, sys, tarfile
expected = {'raphie', 'raphie-runtime', 'raphie-web', 'install.sh', 'raphie.service', 'raphie-admin', 'keyring-session.sh', 'update.sh', 'restore.sh', 'uninstall.sh', 'recovery-key.py', 'bundle-id.sh', 'download-release.sh'}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    names = [m.name for m in members]
    if len(names) > 64 or len(names) != len(set(names)) or 'raphie-smoke' in names or not expected.issubset(names) or any(not m.isfile() or m.size > 500_000_000 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', m.name) for m in members):
        raise SystemExit('Invalid release archive contents.')
    for member in members:
        with archive.extractfile(member) as source, open(os.path.join(sys.argv[2], member.name), 'xb') as target:
            while chunk := source.read(1024 * 1024): target.write(chunk)
        os.chmod(os.path.join(sys.argv[2], member.name), 0o644 if member.name == 'raphie.service' else 0o755)
PY
echo "Downloaded $tag ($asset)."
