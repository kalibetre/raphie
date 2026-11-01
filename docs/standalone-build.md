# Standalone build experiment

This is an experimental packaging and local installation check. The existing
source-based installer remains separate. Automatic HTTPS setup is not provided.

From a clean working tree with the project's pinned Bun and dependencies:

```sh
sh scripts/build-standalone.sh bun-linux-x64 v0.0.0-test test-build
```

The alternative target is `bun-linux-arm64`. The output under
`dist/standalone/<target>` contains `raphie`, `raphie-runtime`, `raphie-web`,
and a diagnostic `raphie-smoke`. The first two arguments after the target are
the version and build identity embedded in the web client and host. Run
`raphie-smoke` on a matching Linux machine to exercise the embedded worker and
container guest. `raphie-smoke --container` additionally needs the configured
Docker/Podman command and workspace image and executes a disposable sandbox
command. It creates a temporary workspace and removes it after the check.

The compiled launcher starts the separate runtime and web executables from its
own directory. Use `raphie start --data-dir /absolute/path` to test with a
new empty directory, never the user's normal data. Without an override, standalone
builds use `~/.local/share/raphie` on Linux (or `$XDG_DATA_HOME/raphie`),
`~/Library/Application Support/Raphie` on macOS, and `%LOCALAPPDATA%/Raphie`
on Windows. The Linux system installer instead defaults to `/var/lib/raphie/data`.
Standalone builds disable
Bun's automatic dotenv and bunfig loading. Configuration must be supplied by
the surrounding supervisor; this prototype does not yet reproduce the
source-based Varlock configuration workflow.

On Linux with D-Bus, GNOME Keyring, libsecret, curl, and Python installed,
`sh scripts/standalone-integration.sh "$(pwd)/dist/standalone/bun-linux-x64"`
starts the compiled service with synthetic data and verifies the web proxy,
runtime, build metadata, assets, and the compiled installation health check. The experimental CI workflow builds and
exercises both architectures; its uploaded artifacts are not published releases.

The embedded web assets, version endpoint, worker, and guest packaging were
checked on Linux x64 and ARM64 using synthetic data. The launcher, runtime and
web API proxy were exercised together on Linux ARM64, and a compiled host
executed the embedded guest through a real disposable container on macOS.
This does not yet prove a Linux container sandbox end to end.

The tag-triggered release workflow tests both Linux architectures, attests the
archives, and creates a **draft** GitHub release. It does not publish the draft.
The installer downloads public releases over HTTPS without GitHub CLI and does
not verify their provenance or checksums. It checks archive structure before
extracting. Obtain and inspect the bootstrap and downloader scripts from a
trusted source. A compromised download could run code as root during installation.

Place copies of `scripts/linux-binary/bootstrap.sh` and `download-release.sh`
together, then run `sudo sh bootstrap.sh v0.0.4-alpha.1` for the alpha, or
`sudo sh bootstrap.sh` for the latest stable release. The script installs OS
dependencies and the binary bundle; it does not install Bun. `sudo raphie update`
selects the latest stable release; pass an explicit version such as
`sudo raphie update v0.0.4-alpha.1` to select an alpha.

For example, once that alpha is published, a clean Ubuntu host can obtain the
two scripts and configure a Tailscale HTTPS origin during installation:

```sh
mkdir raphie-install && cd raphie-install
curl -fsSLO https://raw.githubusercontent.com/kalibetre/raphie/v0.0.4-alpha.1/scripts/linux-binary/bootstrap.sh
curl -fsSLO https://raw.githubusercontent.com/kalibetre/raphie/v0.0.4-alpha.1/scripts/linux-binary/download-release.sh
sudo sh bootstrap.sh v0.0.4-alpha.1 --web-origin https://MACHINE.TAILNET.ts.net
```

Replace the example origin with the actual lowercase Tailscale DNS name and
HTTPS port if needed, and configure Tailscale Serve as described below. If you
omit `--web-origin`, the default is loopback HTTP for use with an SSH tunnel.
Run `raphie port` to print the configured local web port. Existing installations
keep their previous port when updated; the new default applies to fresh installs.
Run `sudo raphie --help` to list the installed service and administrator
commands. Use `sudo raphie update --help`, `sudo raphie restore --help`, or
`sudo raphie uninstall --help` for their arguments and effects.
Earlier experimental installers and updaters do not support the current bundle
layout. They require a separately planned migration; do not assume an in-place
update from an earlier experimental build is supported.

`sudo raphie uninstall` stops and removes the service and program files after
confirmation. It preserves the configured data directory, `/etc/raphie`, the
service user's home and keyrings, backups, and the `raphie` user and group so
their ownership and host-bound credential material remain intact. Preserved
backups still require the matching release and host credential material for
recovery; the installer currently refuses to overwrite a retained installation.
Use `sudo raphie uninstall --purge` instead to remove those Raphie data and
backups as well. Purge requires a separate confirmation and refuses unsafe
data paths and mounted filesystems. Neither mode removes systemd's shared host
credential key or shared OS dependencies. Choose purge when uninstalling: after
the program has been removed, the uninstall command is no longer installed.

For an isolated Linux test machine with systemd, D-Bus, GNOME Keyring,
libsecret, Python 3 and the utilities used by `install.sh`, copy the built
bundle to the machine and run `sudo sh install.sh`. The default browser origin
is `http://127.0.0.1:41837` and the default data directory is
`/var/lib/raphie/data`. `--web-origin` and `--data-dir` override them; existing
data is never overwritten. Existing parents of a custom data directory must be
root-owned and not group- or world-writable. The web host starts locked; create
the administrator with `sudo raphie auth setup` (see
[authentication](authentication.md)). Use this only on an isolated test
installation. A loopback HTTP origin can be reached from another machine with
an SSH tunnel.

### Tailnet access

For an experimental tailnet deployment, Tailscale Serve can provide HTTPS to
the loopback web host. Enable MagicDNS and HTTPS certificates in the tailnet,
and configure tailnet access controls for the devices allowed to connect.
Tailscale's certificate names are published in Certificate Transparency logs.
The service remains protected by Raphie's administrator sign-in and device
authorization; Tailscale identity headers are not used as authentication.

On a fresh test installation, set the exact HTTPS origin for the machine's
Tailscale DNS name, then serve the loopback web port:

```sh
sudo sh install.sh --web-origin https://MACHINE.TAILNET.ts.net
sudo tailscale serve --bg http://127.0.0.1:41837
sudo raphie auth setup
```

Use the machine's actual, lowercase Tailscale DNS name, without a trailing
slash. Visit that HTTPS origin from a permitted tailnet device. The web service
continues to bind to `127.0.0.1`; the runtime port remains local and must never
be exposed. A configured HTTPS origin requires a trusted TLS-terminating proxy;
do not send its traffic over plaintext HTTP. The local health check remains
available on the loopback listener. Browser access uses the configured HTTPS
origin; local browsers can also use `http://127.0.0.1:41837` or
`http://localhost:41837`. Each address has its own browser sign-in session.

The installer records a primary origin at installation. Inspect it and add
other HTTPS addresses to an existing installation with:

```sh
sudo raphie origins
sudo raphie set-origins "https://raphie.example.com,https://another.example.com:8443"
```

`set-origins` replaces the additional list and restarts the service. Pass `""`
to clear that list. The existing primary and local loopback origins remain;
use `origins` to see all three. Each origin has its own browser sign-in session.
Include the scheme and any non-default port, with no paths or spaces.
Non-loopback addresses require HTTPS and a separately configured TLS proxy.
Tailscale Serve is one way to provide such a proxy. Tailscale
Serve and custom-domain deployments have not yet been verified end to end in a
real tailnet. A future custom domain also needs a trusted HTTPS proxy and its
own network and certificate configuration; Serve's DNS names are limited to
the tailnet domain. Do not use Funnel to make this experimental service public.

For local test bundles, `sudo raphie update /path/to/trusted/bundle` takes an
offline backup before switching. `sudo raphie restore /var/backups/raphie/...`
restores a matching backup after confirmation. These commands have only been
exercised with synthetic data in a disposable Ubuntu container and on an
Ubuntu VM using real systemd and temporarily extracted keyring dependencies.
Verification of an actual published release remains untested; do not rely on
this for production. A failed install may require manual cleanup.

### Cross-host credential recovery

The normal offline backup contains the data and encrypted GNOME Keyring files,
but not the host-bound credential that unlocks that keyring. Before losing the
original host, install `age` and export an encrypted recovery key using a native
age public recipient:

```sh
sudo raphie recovery-key export AGE_PUBLIC_RECIPIENT /secure/path/raphie-key.age
```

Create the age identity in a secure location and store it separately from both
the recovery key and the backup. Anyone with both the identity and recovery key
can unlock the keyring in a matching backup. The export refuses to overwrite an
existing file, writes mode `0600`, and never writes the plaintext unlock
credential to disk. Keep an export corresponding to each backup; if the source
host and this recovery material are lost, encrypted provider and channel
credentials cannot be recovered.

On the replacement host, install the exact matching binary bundle, including
its release metadata, and put the offline backup and its `.release` file under
`/var/backups/raphie`. Make the encrypted recovery key and age identity readable
by root through a secure transfer, install `age`, then run:

```sh
sudo raphie restore /var/backups/raphie/raphie-XXXXXXXX.tar \
  --recovery-key /secure/path/raphie-key.age --identity /secure/path/age-identity
```

The restore checks and re-encrypts the unlock credential for the new host
before stopping the service; a wrong identity leaves the running service alone.
It then restores the matching data and keyring. Previous data, keyrings and the
destination's prior host credential are retained beside the staging directory
for manual recovery. Protect and eventually remove those retained files.
Store the identity separately from the server when the operation is complete.
This procedure was exercised using synthetic keyring data on two isolated
Ubuntu ARM64 machines with distinct systemd host keys. Their LXC environment
required a test-only systemd credential override; both installations and test
keys were removed afterward.

On 2026-10-31, the current administrator-authentication build was also tested
with synthetic data on an x64 Ubuntu VM using unmodified systemd credentials.
Installation, administrator setup and sign-in, service restart, password
recovery, update, backup restore, and recovery after a failed update passed.
This does not establish release provenance.
