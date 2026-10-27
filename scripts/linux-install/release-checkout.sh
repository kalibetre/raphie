#!/bin/sh
set -eu

# Print the latest stable release tag. The caller supplies an empty checkout path.
destination=${1:?A checkout destination is required.}
tag=$(curl -fsSL https://api.github.com/repos/kalibetre/raphie/releases/latest | python3 -c '
import json, re, sys
tag = json.load(sys.stdin).get("tag_name", "")
if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
    raise SystemExit("No supported stable Raphie release was found.")
print(tag)
')
git clone --quiet --depth 1 --branch "$tag" https://github.com/kalibetre/raphie.git "$destination"
test "$(git -C "$destination" describe --tags --exact-match HEAD)" = "$tag"
printf '%s\n' "$tag"
