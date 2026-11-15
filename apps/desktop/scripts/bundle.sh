#!/usr/bin/env bash
# Wraps the desktop client in a macOS app bundle under target/bundle.
#
#   scripts/bundle.sh            the dev app:     target/bundle/Raphie Dev.app
#   scripts/bundle.sh --release  the release app: target/bundle/Raphie.app
#   open "target/bundle/Raphie Dev.app"
#
# macOS gives some things only to an app with a bundle identifier, and
# system notifications are one: a bare binary (`cargo run`) cannot post
# them.
#
# The two are separate apps: their own name, identifier, icon, settings and
# sign-in, so both can be installed at once. The names here must match
# `Flavor` in core/src/flavor.rs, which the program itself uses.
#
# Both are signed ad hoc (no Apple account), which is enough to run on this
# machine. Neither is a distributable release: there is no Developer ID
# signature, no notarisation and no updater.
set -euo pipefail
cd "$(dirname "$0")/.."

profile=debug
flavor=dev
name="Raphie Dev"
identifier=dev.raphie.desktop.dev
if [[ "${1:-}" == "--release" ]]; then
  profile=release
  flavor=release
  name="Raphie"
  identifier=dev.raphie.desktop
  cargo build -p raphie-desktop --release
fi
# The debug build is always needed: only it can draw the icon (below).
cargo build -p raphie-desktop
bin="target/$profile/raphie-desktop"

# The version the app shows (core/src/updates.rs): RAPHIE_VERSION if set,
# else the repository's VERSION file. macOS wants only "1.2.3" here, so a
# leading "v" and any "-nightly…" part are cut off.
version="${RAPHIE_VERSION:-$(cat ../../VERSION)}"
version="${version#v}"
version="${version%%-*}"
app="target/bundle/$name.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/raphie-desktop"

# The icon. The program draws its own (app/src/app_icon.rs), 1024 px
# square. The debug binary draws it for both apps, since a release build
# has no `--snap`. `sips` scales that to each size macOS asks for, and
# `iconutil` packs the folder into one .icns file. "@2x" is the same
# picture at twice the pixels, for Retina screens.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
iconset="$work/AppIcon.iconset"
mkdir -p "$iconset"
RAPHIE_ICON=$flavor target/debug/raphie-desktop --snap "$work/icon.png" --size 1024x1024 --scale 1 >/dev/null 2>&1
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$work/icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$work/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$identifier</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundleDisplayName</key><string>$name</string>
  <key>CFBundleExecutable</key><string>raphie-desktop</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
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
echo "Built $app ($profile, version $version, $identifier)"
