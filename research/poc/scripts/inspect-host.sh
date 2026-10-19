#!/usr/bin/env bash
# Read-only inspection. Deliberately excludes process arguments and environment values.
set -u
date -u +'%Y-%m-%dT%H:%M:%SZ'
hostname
uname -srmo
cat /etc/os-release
lscpu | sed -n '/Architecture:/p; /CPU(s):/p; /Model name:/p; /Virtualization:/p; /Hypervisor vendor:/p'
free -h
df -h / "$HOME"
uptime
id
ls -l /dev/kvm
if test -r /dev/kvm && test -w /dev/kvm; then
  echo 'KVM_ACCESS=read-write'
else
  echo 'KVM_ACCESS=unavailable-to-current-user'
fi
if sudo -n true 2>/dev/null; then echo 'SUDO_NONINTERACTIVE=yes'; else echo 'SUDO_NONINTERACTIVE=no'; fi
node --version
npm --version
command -v pnpm || true
command -v msb || true
command -v git || true
command -v python3 || true
docker version --format 'Docker server: {{.Server.Version}}' 2>/dev/null || true
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null || true
ps -eo pid,comm,pcpu,rss --sort=-rss | head -16
ss -ltn
cat /proc/pressure/memory
cat /sys/fs/cgroup/cgroup.controllers
test ! -e "$HOME/raphie-prototype" || ls -ld "$HOME/raphie-prototype"
