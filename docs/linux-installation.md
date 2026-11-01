# Linux server installation (alpha)

Raphie's standalone binary installer is experimental and supports Debian and Ubuntu with systemd on x64 and ARM64. It installs a service running as the `raphie` user, with the runtime and web host bound to loopback. See [standalone builds](standalone-build.md) for prerequisites, installation commands, HTTPS access, updates, uninstall and limitations. Use an explicit published alpha tag: the installer and updater select stable releases by default.

The installer downloads public releases over HTTPS but does not verify their provenance or checksums. Download and inspect both scripts from a trusted release tag before running them as root. A compromised download could execute code as root.

After installation, create the administrator with `sudo raphie auth setup` and sign in through the web interface. The default local web port is 41837; `raphie port` displays it and `sudo raphie set-port 41838` changes it. For remote access, configure a trusted HTTPS proxy as described in the standalone guide. Keep the unauthenticated runtime port on loopback. See [authentication](authentication.md) for sign-in and device authorization.

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
