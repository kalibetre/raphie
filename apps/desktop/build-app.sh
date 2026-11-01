#!/bin/sh
set -eu

# Local, unsigned development bundle; distribution signing is separate work.
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
package="$root/apps/desktop"
output="$root/dist/desktop/Raphie.app"
scratch="${RAPHIE_DESKTOP_SCRATCH:-${TMPDIR:-/tmp}/raphie-desktop-build}"
swift build --package-path "$package" --scratch-path "$scratch" -c release --product RaphieDesktop
bin=$(swift build --package-path "$package" --scratch-path "$scratch" -c release --show-bin-path)
mkdir -p "$output/Contents/MacOS"
cp "$bin/RaphieDesktop" "$output/Contents/MacOS/RaphieDesktop"
cat > "$output/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>RaphieDesktop</string>
  <key>CFBundleIdentifier</key><string>com.raphie.desktop</string>
  <key>CFBundleName</key><string>Raphie</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$output"
printf 'Development app: %s\n' "$output"
