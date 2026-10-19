#!/usr/bin/env bash
# Run only prototype commands as the current user, adding kvm for this process.
# A transient systemd scope caps this command and its descendants; no persistent unit.
set -euo pipefail
cd "$(dirname "$0")/.."
available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if (( available < 5 * 1024 * 1024 )); then
  echo 'Refusing to start: less than 5 GiB RAM available for development workloads.' >&2
  exit 75
fi
uid=$(id -u)
gid=$(id -g)
kvm_gid=$(getent group kvm | cut -d: -f3)
groups="$(id -G | tr ' ' ','),$kvm_gid"
exec sudo -n systemd-run --scope --quiet --unit="raphie-prototype-$$" \
  --property=MemoryMax=${SCOPE_MEM:-2G} --property=CPUQuota=150% --property=TasksMax=256 \
  /usr/bin/setpriv --reuid="$uid" --regid="$gid" --groups="$groups" \
  /usr/bin/env HOME="$HOME" PATH="$PWD/node_modules/.bin:/usr/local/bin:/usr/bin:/bin" \
  MSB_PATH="$PWD/node_modules/@superradcompany/microsandbox-linux-x64-gnu/bin/msb" \
  EVE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 "$@"
