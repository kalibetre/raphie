#!/bin/sh
set -eu

# Experimental build for isolated verification, not a release installer.
target=${1:?Usage: sh scripts/build-standalone.sh bun-linux-x64\|bun-linux-arm64 [version] [build-id]}
case "$target" in bun-linux-x64|bun-linux-arm64) ;; *) echo 'Unsupported target.' >&2; exit 1;; esac
version=${2:-development}
revision=${3:-development}
case "$version$revision" in *[!a-zA-Z0-9._+-]*) echo 'Invalid version or build ID.' >&2; exit 1;; esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
output="$root/dist/standalone/$target"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT HUP INT TERM
mkdir -p "$output"

printf '%s\n%s\n' "$revision" "$version" > "$temp/.raphie-build"
RAPHIE_BUILD_ID="$revision" RAPHIE_VERSION="$version" bun run build
bun build packages/runtime/src/domains/workspaces/infrastructure/container-guest.ts --target=node --format=esm --minify --outfile "$temp/raphie-sandbox-guest.js"
bun build --compile --target="$target" --no-compile-autoload-dotenv --no-compile-autoload-bunfig --asset "$temp/raphie-sandbox-guest.js" packages/runtime/src/main.ts packages/runtime/src/domains/workspaces/infrastructure/workspace-worker.ts --outfile "$output/raphie-runtime"
bun build --compile --target="$target" --no-compile-autoload-dotenv --no-compile-autoload-bunfig --asset apps/web/dist --asset "$temp/.raphie-build" apps/web/server.mjs --outfile "$output/raphie-web"
bun build --compile --target="$target" --no-compile-autoload-dotenv --no-compile-autoload-bunfig scripts/raphie.ts --outfile "$output/raphie"
bun build --compile --target="$target" --no-compile-autoload-dotenv --no-compile-autoload-bunfig --asset "$temp/raphie-sandbox-guest.js" scripts/standalone-smoke.ts packages/runtime/src/domains/workspaces/infrastructure/workspace-worker.ts --outfile "$output/raphie-smoke"
cp scripts/linux-binary/install.sh scripts/linux-binary/raphie.service scripts/linux-binary/raphie-admin scripts/linux-binary/update.sh scripts/linux-binary/restore.sh scripts/linux-binary/uninstall.sh scripts/linux-binary/bundle-id.sh scripts/linux-binary/download-release.sh scripts/linux-install/keyring-session.sh "$output/"
echo "Experimental binaries: $output"
