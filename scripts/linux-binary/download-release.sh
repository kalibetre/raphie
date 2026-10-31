#!/bin/sh
set -eu

# Fetch only stable releases from the project's GitHub repository. Verify the
# archive before inspecting or extracting any of its contents.
destination=${1:?Destination directory required}
requested=${2:-}
test "$#" -le 2 || { echo 'Expected destination and optional version.' >&2; exit 1; }
for command in curl gh python3; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
case "$(uname -m)" in
  x86_64) asset=raphie-linux-x64.tar.gz ;;
  aarch64|arm64) asset=raphie-linux-arm64.tar.gz ;;
  *) echo 'Unsupported Linux architecture.' >&2; exit 1 ;;
esac
if [ -n "$requested" ]; then
  printf '%s' "$requested" | python3 -c 'import re,sys; re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", sys.stdin.read()) or sys.exit("Expected a version such as v1.2.3.")'
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
if release.get('draft') is not False or release.get('prerelease') is not False or not isinstance(tag, str) or not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag) or (sys.argv[2] and tag != sys.argv[2]):
    raise SystemExit('No matching stable Raphie release is available.')
print(tag)
PY
)
curl -fsSL "https://github.com/kalibetre/raphie/releases/download/$tag/$asset" -o "$tmp/$asset"
gh attestation verify "$tmp/$asset" --hostname github.com --repo kalibetre/raphie --signer-workflow kalibetre/raphie/.github/workflows/release.yml --source-ref "refs/tags/$tag" --deny-self-hosted-runners
python3 - "$tmp/$asset" "$destination" <<'PY'
import os, sys, tarfile
expected = {'raphie', 'raphie-runtime', 'raphie-web', 'install.sh', 'raphie.service', 'raphie-admin', 'keyring-session.sh', 'update.sh', 'restore.sh', 'bundle-id.sh', 'download-release.sh'}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    if len(members) != len(expected) or {m.name for m in members} != expected or any(not m.isfile() or m.size > 500_000_000 for m in members):
        raise SystemExit('Invalid release archive contents.')
    for member in members:
        with archive.extractfile(member) as source, open(os.path.join(sys.argv[2], member.name), 'xb') as target:
            while chunk := source.read(1024 * 1024): target.write(chunk)
        os.chmod(os.path.join(sys.argv[2], member.name), 0o644 if member.name == 'raphie.service' else 0o755)
PY
echo "Verified $tag ($asset)."
