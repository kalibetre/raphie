#!/bin/sh
set -eu
[ "${RAPHIE_DISPOSABLE_TEST:-}" = 1 ] || { echo "Run only inside a disposable test container." >&2; exit 1; }
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends dbus gnome-keyring libsecret-1-0 python3 curl passwd >/dev/null
useradd -m fixture
mkdir -p /tmp/raphie-test-bin /tmp/raphie-fixture
printf '%s\n' '[{"tag_name":"v0.0.4-alpha.2","draft":false,"prerelease":true}]' > /tmp/raphie-fixture/release.json
tar -czf /tmp/raphie-fixture/archive.tar.gz -C /binaries raphie raphie-runtime raphie-web
cat > /tmp/raphie-test-bin/curl <<'SH'
#!/bin/sh
case "$2" in *api.github.com*) cp /tmp/raphie-fixture/release.json "$4";; *) cp /tmp/raphie-fixture/archive.tar.gz "$4";; esac
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
  "$HOME/.local/bin/raphie" start >$HOME/service.log 2>&1 &
  pid=$!
  trap '\''kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true'\'' EXIT HUP INT TERM
  count=0
  until /usr/bin/curl -fsS http://127.0.0.1:4320/_raphie/health >/dev/null 2>&1; do
    if ! kill -0 "$pid" 2>/dev/null || [ "$count" -ge 20 ]; then cat $HOME/service.log; exit 1; fi
    count=$((count+1)); sleep 1
  done
  echo "User installer and compiled service started successfully without sudo."
'
