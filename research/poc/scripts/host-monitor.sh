#!/usr/bin/env bash
# Append one line per second and fsync, so a hard crash still leaves a trail. Stop with SIGTERM.
out=${1:-results/host-monitor.log}
while true; do
  echo "$(date -u +%T) load=$(cut -d' ' -f1-3 /proc/loadavg) avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)MiB psi_mem=$(awk '/some/{print $2}' /proc/pressure/memory) psi_io=$(awk '/some/{print $2}' /proc/pressure/io) top=$(ps -eo rss,comm --sort=-rss | sed -n 2,3p | tr '\n' ' ')" >> "$out"
  sync -d "$out" 2>/dev/null
  sleep 1
done
