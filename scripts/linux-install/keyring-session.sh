#!/bin/sh
set -eu

# systemd supplies this file via LoadCredentialEncrypted. D-Bus and the
# keyring stay scoped to the service and are shut down with the process.
: "${CREDENTIALS_DIRECTORY:?systemd credential directory is required}"
test -r "$CREDENTIALS_DIRECTORY/raphie-keyring"
# The inner shell must expand the credential directory and command arguments.
# shellcheck disable=SC2016
exec dbus-run-session -- sh -c '
  set -eu
  gnome-keyring-daemon --unlock < "$CREDENTIALS_DIRECTORY/raphie-keyring" > /dev/null
  exec "$@"
' sh "$@"
