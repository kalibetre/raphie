# Linux server installation (experimental)

This is an experimental installation path, not yet a release. It requires a
clean committed checkout, Linux with systemd and a Secret Service provider.
Installation, service restart, update, and backup restore have been exercised
on an Ubuntu 24.04 VM with systemd using synthetic data. Do not deploy it until
the remaining security review and recovery verification are complete.

The server runs as the `raphie` user. The web listener requires an owner login;
the runtime listens only on loopback. A private HTTP deployment must bind only
to a trusted private interface such as the machine's Tailscale address. HTTP
does not encrypt traffic itself. Public network access requires HTTPS and a
trusted reverse proxy. Local development continues to bind to loopback without
an account.

From a local Raphie installation, Settings → Backend connection can connect to
an authenticated remote gateway. Enter the gateway URL and owner credentials;
the browser can save addresses, but passwords are not saved. Remote sessions
are held in the local web server's memory, so restart requires signing in again.
HTTP connections are limited to loopback tunnels and Tailscale-range IPv4
addresses; use HTTPS for other addresses. A 100.64.0.0/10 address alone does not
prove that traffic is on Tailscale: configure the host and network accordingly.

The installer requires Git, Bun 1.4.4 at `/usr/local/bin/bun`, systemd with
`systemd-creds`, D-Bus, GNOME Keyring and libsecret. From a clean checkout,
`sudo sh scripts/linux-install/install.sh` prompts for a browser-facing origin,
bind address, username and password. The installer refuses to replace an
existing installation. It currently needs manual cleanup after a failed setup.

`sudo raphie auth reset-password` resets the owner account and revokes existing
sessions. The Account link in the web app changes credentials after verifying
the current password and signs out all sessions. `raphie status` checks the local runtime. `sudo raphie update
/path/to/clean/checkout` prepares a new committed version and stops the service
before backing up the data and keyring. It then switches the release and waits
for the runtime to respond. The source checkout must already be updated; the
command does not fetch a release for you. Long-running work can be interrupted.

If startup fails after the version switch, the updater leaves the service
stopped and prints the backup location. Database migrations may be irreversible:
do not restart an older release against newer data. Restore a consistent data
and keyring backup before attempting recovery. Run `sudo raphie restore
/var/backups/raphie/raphie-XXXXXXXX.tar` to restore the backup and its matching
installed release. The command requires interactive confirmation and preserves
the replaced data and keyrings under `/var/lib/raphie/.restore-*.before-*`.

The backup includes the data and the encrypted GNOME Keyring files. It does not
include `/etc/raphie/keyring.cred` or the systemd host credential key. Back up
those separately with appropriate protection and test recovery on the target
platform; without them the encrypted provider and channel credentials may be
unrecoverable. Root access can recover host-bound credentials, so this does not
protect against a compromised host.
