#!/usr/bin/env bash
# Wraps the desktop client in a macOS app bundle: target/bundle/Raphie.app.
#
# macOS gives some things only to an app with a bundle identifier, and
# system notifications are one: a bare binary (`cargo run`) cannot post
# them. This is a development bundle, signed ad hoc (no Apple account), for
# running on this machine. It is not a release: there is no icon, no
# notarisation and no updater.
#
#   scripts/bundle.sh            debug build
#   scripts/bundle.sh --release  release build
#   open target/bundle/Raphie.app
set -euo pipefail
cd "$(dirname "$0")/.."

profile=debug
flags=()
if [[ "${1:-}" == "--release" ]]; then
  profile=release
  flags=(--release)
fi
# `${flags[@]+...}` expands to nothing when the list is empty; a plain
# "${flags[@]}" is an error under `set -u` in the bash macOS ships.
cargo build -p raphie-desktop ${flags[@]+"${flags[@]}"}

version=$(cargo metadata --no-deps --format-version 1 |
  python3 -c 'import json,sys; print(next(p["version"] for p in json.load(sys.stdin)["packages"] if p["name"]=="raphie-desktop"))')
app=target/bundle/Raphie.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "target/$profile/raphie-desktop" "$app/Contents/MacOS/raphie-desktop"

# The identifier is the one the token store already uses for the Keychain.
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.raphie.desktop</string>
  <key>CFBundleName</key><string>Raphie</string>
  <key>CFBundleDisplayName</key><string>Raphie</string>
  <key>CFBundleExecutable</key><string>raphie-desktop</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# "-" signs ad hoc: enough for macOS to treat the bundle as one app whose
# permissions (notifications among them) it can remember.
codesign --force --sign - "$app"
echo "Built $app ($profile, version $version)"
