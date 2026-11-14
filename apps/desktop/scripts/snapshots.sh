#!/usr/bin/env bash
# Renders every scene in light and dark into docs/images/desktop, headless
# (Rune's --snap: same renderer as the window, no window, no network).
# Needs a GPU, so it runs locally rather than in CI.
set -euo pipefail
cd "$(dirname "$0")/.."
out=../../docs/images/desktop
mkdir -p "$out"
cargo build -p raphie-desktop
bin=target/debug/raphie-desktop
# 1280x800 at 2x is the size of the web workspace's reference screenshots, so
# the two can be compared side by side. --chrome draws the traffic lights
# where macOS puts them.
for scene in sign-in device-code new-conversation conversations conversation tools streaming working approval; do
  for theme in light dark; do
    "$bin" --snap "$out/$scene-$theme.png" --scene "$scene" --theme "$theme" \
      --size 1280x800 --scale 2 --at 1.5 --chrome
  done
done
echo "Wrote $(ls "$out" | wc -l | tr -d ' ') snapshots to docs/images/desktop"
