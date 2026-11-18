#!/usr/bin/env bash
# Renders every scene in light and dark into target/snapshots, headless
# (Rune's --snap: same renderer as the window, no window, no network).
# Needs a GPU, so it runs locally rather than in CI. The images are for
# looking at and for pull requests; target/ is ignored, so none are committed.
set -euo pipefail
cd "$(dirname "$0")/.."
out=target/snapshots
mkdir -p "$out"
cargo build -p raphie-desktop
bin=target/debug/raphie-desktop
# 1280x800 at 2x is the size of the web workspace's reference screenshots, so
# the two can be compared side by side. --chrome draws the traffic lights
# where macOS puts them.
for scene in sign-in sign-in-this-mac device-code new-conversation conversations conversations-archived unread inbox inbox-empty conversation conversation-archived attachments image-viewer model-picker model-picker-favorites model-picker-family permissions composer composer-full-access composer-context composer-nearly-full tools reply-failed streaming working approval \
  settings-account settings-appearance settings-profile settings-profile-edited \
  settings-models settings-models-filter settings-providers settings-providers-add settings-providers-sign-in settings-providers-subscription \
  settings-memory settings-memory-hindsight settings-memories settings-memories-editing \
  settings-mcp settings-mcp-command \
  settings-channels settings-channels-discord settings-channels-telegram \
  settings-sandbox settings-sandbox-container \
  settings-workspace settings-workspace-folder \
  settings-jobs settings-jobs-create \
  settings-account settings-account-unreachable settings-account-runtime-down \
  settings-diagnostics settings-activity settings-about settings-about-update settings-about-nightly dev-build nightly-build \
  settings-history settings-new-bot settings-delete-bot; do
  for theme in light dark; do
    "$bin" --snap "$out/$scene-$theme.png" --scene "$scene" --theme "$theme" \
      --size 1280x800 --scale 2 --at 1.5 --chrome
  done
done
echo "Wrote $(ls "$out" | wc -l | tr -d ' ') snapshots to apps/desktop/target/snapshots"
