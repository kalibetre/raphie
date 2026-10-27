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

The release installer supports Debian and Ubuntu with systemd. After a stable
GitHub release has been published and the bootstrap script is available on
`main`, download and inspect the script before running it:

```sh
curl -fsSLo install-raphie.sh https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/linux-install/bootstrap.sh
sudo sh install-raphie.sh
```

Pass a published version such as `v1.2.3` as an argument to install that
specific release. Without an argument it selects the latest stable release.
It installs required OS packages and Bun 1.4.4, verifying Bun against pinned
checksums. It prompts for a browser-facing origin, bind address, username and
password, and refuses to replace an existing installation or a different Bun
at `/usr/local/bin/bun`. Failed setup currently needs manual cleanup. The
repository has no published release yet, so this command is not available
until the first release is published.

`sudo raphie auth reset-password` resets the owner account and revokes existing
sessions. The Account link in the web app changes credentials after verifying
the current password and signs out all sessions. `raphie status` checks the
local runtime. `sudo raphie update` fetches the latest stable GitHub release;
alternatively, `sudo raphie update /path/to/clean/checkout` uses a local
committed checkout. The updater prepares the version and stops the service
before backing up the data and keyring. It then switches the release and waits
for the runtime and web host to respond. Long-running work can be interrupted.
The web app shows its version in Appearance settings and offers to reload when
its web host changes versions; it never reloads automatically.

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
