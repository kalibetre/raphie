#!/usr/bin/env bash
# Builds the release app and packs it into a disk image, for Apple Silicon
# Macs only:
#
#   scripts/dmg.sh    target/dist/Raphie-macos-arm64.dmg
#
# The release workflow runs it on an Apple Silicon runner. Set
# RAPHIE_VERSION (for example v0.0.5 or v0.0.5-nightly.20261116.1.1) to
# stamp the version the app shows and compares when it checks for updates.
#
# The image holds Raphie.app and a link to /Applications, so installing is
# dragging one onto the other. It is signed ad hoc only: there is no Apple
# Developer ID yet, so the first launch needs "Open Anyway" in System
# Settings → Privacy & Security (docs/desktop.md).
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(uname -m)" = arm64 ] || { echo 'The desktop app is built for Apple Silicon Macs only.' >&2; exit 1; }
scripts/bundle.sh --release
app="target/bundle/Raphie.app"

# Refuse to pack an app that is not whole: the bundle's signature, its
# Info.plist, its icon, and a program built for this architecture.
codesign --verify --strict "$app"
plutil -lint -s "$app/Contents/Info.plist"
test -s "$app/Contents/Resources/AppIcon.icns"
lipo -archs "$app/Contents/MacOS/raphie-desktop" | grep -qw arm64

out="target/dist/Raphie-macos-arm64.dmg"
mkdir -p target/dist
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"
rm -f "$out"
# UDZO: compressed and read-only, the usual format for handing out an app.
hdiutil create -quiet -volname "Raphie" -srcfolder "$stage" -fs HFS+ -format UDZO "$out"
hdiutil verify -quiet "$out"
echo "Built $out"
