#!/bin/sh
set -eu
[ "${RAPHIE_DISPOSABLE_TEST:-}" = 1 ] || { echo "Run only inside a disposable test container." >&2; exit 1; }
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends dbus gnome-keyring libsecret-1-0 python3 curl passwd >/dev/null
useradd -m fixture
mkdir -p /tmp/raphie-test-bin /tmp/raphie-fixture
printf '%s\n' '[{"tag_name":"v0.0.4","draft":false,"prerelease":false,"assets":[{"name":"raphie-linux-arm64.tar.gz"},{"name":"raphie-linux-x64.tar.gz"},{"name":"SHA256SUMS"}]}]' > /tmp/raphie-fixture/release.json
printf '%s\n' '[{"tag_name":"v0.0.5","draft":false,"prerelease":false,"assets":[{"name":"raphie-linux-arm64.tar.gz"},{"name":"raphie-linux-x64.tar.gz"},{"name":"SHA256SUMS"}]}]' > /tmp/raphie-fixture/release-next.json
printf '%s\n' '{"status":"ahead"}' > /tmp/raphie-fixture/compare.json
tar -czf /tmp/raphie-fixture/archive.tar.gz -C /binaries raphie raphie-runtime raphie-web
checksum=$(sha256sum /tmp/raphie-fixture/archive.tar.gz | cut -d " " -f 1)
printf '%s  raphie-linux-arm64.tar.gz\n%s  raphie-linux-x64.tar.gz\n' "$checksum" "$checksum" > /tmp/raphie-fixture/SHA256SUMS
cat > /tmp/raphie-test-bin/curl <<'SH'
#!/bin/sh
case "$2" in *api.github.com*/compare/*) cp /tmp/raphie-fixture/compare.json "$4";; *api.github.com*) if [ -e "$HOME/.test-update" ]; then cp /tmp/raphie-fixture/release-next.json "$4"; else cp /tmp/raphie-fixture/release.json "$4"; fi;; *SHA256SUMS) cp /tmp/raphie-fixture/SHA256SUMS "$4";; *) cp /tmp/raphie-fixture/archive.tar.gz "$4";; esac
SH
cat > /tmp/raphie-test-bin/systemctl <<'SH'
#!/bin/sh
exit 1
SH
chmod 755 /tmp/raphie-test-bin/*
runuser -u fixture -- dbus-run-session -- sh -eu -c '
  export HOME=/home/fixture PATH=/tmp/raphie-test-bin:/usr/bin:/bin
  printf "synthetic-only\n" | gnome-keyring-daemon --unlock >/dev/null
  cat /installer | bash
  "$HOME/.local/bin/raphie" channel nightly
  "$HOME/.local/bin/raphie" channel | grep -q nightly
  "$HOME/.local/bin/raphie" channel stable
  "$HOME/.local/bin/raphie" start >$HOME/service.log 2>&1 &
  pid=$!
  trap '\''kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true'\'' EXIT HUP INT TERM
  count=0
  until /usr/bin/curl -fsS http://127.0.0.1:4320/_raphie/health >/dev/null 2>&1; do
    if ! kill -0 "$pid" 2>/dev/null || [ "$count" -ge 20 ]; then cat $HOME/service.log; exit 1; fi
    count=$((count+1)); sleep 1
  done
  printf "preserved\n" > "$HOME/.local/share/raphie/fixture.txt"
  kill "$pid"; wait "$pid" || true; pid=
  touch "$HOME/.test-update"
  cat /installer | bash
  test "$(cat "$HOME/.local/share/raphie/fixture.txt")" = preserved
  backup=$(find "$HOME/.local/share/raphie-backups" -name fixture.txt -print -quit)
  test -n "$backup" && test "$(cat "$backup")" = preserved
  echo "User installation, compiled service, and offline update backup passed without sudo."
'
