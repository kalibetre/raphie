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
The experimental binary downloader verifies the GitHub attestation against the
repository, release workflow, stable tag, and GitHub-hosted runner before it
extracts an archive. It requires GitHub CLI with attestation verification and
network access to GitHub and the Sigstore trust infrastructure. Authentication
may be needed by GitHub CLI; configure it for the account running the command.
The bootstrap and downloader scripts must themselves be obtained and inspected
through a trusted channel. Draft `v0.0.1` was verified on GitHub-hosted x64 and
ARM64 runners using its actual signed archives, including the compiled service
and disposable installation lifecycle. It predates the recovery work below and
is not a final release candidate. The public stable download path and the final
candidate still need end-to-end verification before this is supported.

After a stable release is published, place inspected copies of
`scripts/linux-binary/bootstrap.sh` and `download-release.sh` together, install
GitHub CLI, and run `sudo sh bootstrap.sh` (or pass a stable version such as
`v1.2.3`). The script installs OS dependencies and the verified binary bundle;
it does not install Bun. The installed binary service supports `sudo raphie
update` for the latest stable release, or `sudo raphie update v1.2.3` for a
specific stable release. The `gh` command and its authentication, if needed,
must be available to root as these operations run under sudo.
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
is `http://127.0.0.1:4320` and the default data directory is
`/var/lib/raphie/data`. `--web-origin` and `--data-dir` override them; existing
data is never overwritten. Existing parents of a custom data directory must be
root-owned and not group- or world-writable. The web host starts locked; create
the administrator with `sudo raphie auth setup` (see
[authentication](authentication.md)). Use this only on an isolated test
installation and reach it from another machine through an SSH tunnel, not a
reverse proxy.

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
