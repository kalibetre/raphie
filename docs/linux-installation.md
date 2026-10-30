# Linux server installation (experimental)

This is an experimental installation path, not yet a release. It requires a
clean committed checkout, Linux with systemd and a Secret Service provider.
Installation, service restart, update, and backup restore have been exercised
on an Ubuntu 24.04 VM with systemd using synthetic data. Do not deploy it until
the remaining security review and recovery verification are complete.

The server runs as the `raphie` user. The runtime and web listener bind to
loopback, and the web host rejects non-loopback `Host` headers. The web host is
locked until you create the administrator with `sudo raphie auth setup`, then
requires sign-in; see [authentication](authentication.md). Do not expose it
through a reverse proxy: use an SSH tunnel for remote access. The runtime port
itself is not authenticated and must stay on loopback.

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
checksums. It prompts for a loopback browser origin, and refuses
to replace an existing installation or a different Bun
at `/usr/local/bin/bun`. Failed setup currently needs manual cleanup. The
repository has no published release yet, so this command is not available
until the first release is published.

`raphie status` checks the
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

The backup includes the data (including the administrator's `auth.sqlite` and
`auth.secret`, which are sensitive) and the encrypted GNOME Keyring files. It does not
include `/etc/raphie/keyring.cred` or the systemd host credential key. Back up
those separately with appropriate protection and test recovery on the target
platform; without them the encrypted provider and channel credentials may be
unrecoverable. Root access can recover host-bound credentials, so this does not
protect against a compromised host.
