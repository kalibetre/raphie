#!/bin/sh
set -eu
directory=${1:?A bundle directory is required.}
hashes=$(for file in raphie raphie-runtime raphie-web raphie.service raphie-admin keyring-session.sh update.sh restore.sh uninstall.sh bundle-id.sh download-release.sh; do
  test -f "$directory/$file" && test ! -L "$directory/$file" || { echo "Missing bundle file: $file" >&2; exit 1; }
  sha256sum "$directory/$file" | cut -d ' ' -f 1
done)
printf '%s\n' "$hashes" | sha256sum | cut -d ' ' -f 1
