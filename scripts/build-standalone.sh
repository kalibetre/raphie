#!/bin/sh
set -eu

# Experimental build for isolated verification, not a release installer.
target=${1:?Usage: sh scripts/build-standalone.sh bun-linux-x64\|bun-linux-arm64\|bun-darwin-arm64 [version] [build-id]}
case "$target" in bun-linux-x64|bun-linux-arm64|bun-darwin-arm64) ;; *) echo 'Unsupported target.' >&2; exit 1;; esac
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
bun build packages/runtime/src/domains/workspaces/infrastructure/document-worker.ts --target=bun --format=esm --outfile "$temp/raphie-document-worker.js"
cp node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm "$temp/raphie-anydoc.wasm"
# One executable: the CLI first, so it is what runs, then the runtime and
# the web host, which `raphie start` runs as its own two processes, and the
# workspace worker. Each copy of Bun is about 89 MB, so one copy, not three.
bun build --compile --target="$target" --no-compile-autoload-dotenv --no-compile-autoload-bunfig --define "__RAPHIE_VERSION__=\"$version\"" --asset "$temp/raphie-sandbox-guest.js" --asset "$temp/raphie-document-worker.js" --asset "$temp/raphie-anydoc.wasm" --asset apps/web/dist --asset "$temp/.raphie-build" scripts/raphie.ts packages/runtime/src/main.ts apps/web/server.mjs packages/runtime/src/domains/workspaces/infrastructure/workspace-worker.ts --outfile "$output/raphie"
bun build --compile --target="$target" --no-compile-autoload-dotenv --no-compile-autoload-bunfig --asset "$temp/raphie-sandbox-guest.js" --asset "$temp/raphie-document-worker.js" --asset "$temp/raphie-anydoc.wasm" scripts/standalone-smoke.ts packages/runtime/src/domains/workspaces/infrastructure/workspace-worker.ts --outfile "$output/raphie-smoke"
case "$target" in bun-linux-*)
# A system service before the single executable checks that an update has
# these two files, so they stay, each now handing over to raphie.
for role in runtime web; do
  printf '#!/bin/sh\nexec "$(dirname "$0")/raphie" __%s "$@"\n' "$role" > "$output/raphie-$role"
  chmod 0755 "$output/raphie-$role"
done
cp scripts/linux-binary/install.sh scripts/linux-binary/raphie.service scripts/linux-binary/raphie-admin scripts/linux-binary/update.sh scripts/linux-binary/restore.sh scripts/linux-binary/uninstall.sh scripts/linux-binary/recovery-key.py scripts/linux-binary/bundle-id.sh scripts/linux-binary/download-release.sh scripts/linux-install/keyring-session.sh "$output/"
;; esac
echo "Experimental binaries: $output"
