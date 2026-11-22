#!/usr/bin/env bash
# Prints the version a nightly is named after: one patch past the newest
# stable tag, so a nightly sorts after every stable release so far and before
# whichever comes next, be it a patch, a minor or a major.
#
# Reads tag names on stdin, one a line; `git ls-remote --tags` lines work too.
# Tags that are not a plain vMAJOR.MINOR.PATCH (nightlies, alphas) are ignored.
set -euo pipefail

latest=$(
  sed -E 's#^.*refs/tags/##' |
    { grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || true; } |
    sed 's/^v//' |
    sort -t. -k1,1n -k2,2n -k3,3n |
    tail -1
)
if [[ -z "$latest" ]]; then
  echo 'No stable vMAJOR.MINOR.PATCH tag exists to name a nightly after.' >&2
  exit 1
fi
IFS=. read -r major minor patch <<<"$latest"
echo "$major.$minor.$((patch + 1))"
