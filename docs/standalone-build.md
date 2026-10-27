# Standalone build experiment

This is an experimental packaging and local installation check. The existing
source-based installer remains separate. Automatic HTTPS setup, portable
credential recovery and release verification are not implemented by this
experiment.

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
own directory. The runtime requires an absolute `DATA_DIRECTORY`; test with a
new empty directory, never the user's normal data. Standalone builds disable
Bun's automatic dotenv and bunfig loading. Configuration must be supplied by
the surrounding supervisor; this prototype does not yet reproduce the
source-based Varlock configuration workflow.

On Linux with D-Bus, GNOME Keyring, libsecret, curl, and Python installed,
`sh scripts/standalone-integration.sh "$(pwd)/dist/standalone/bun-linux-x64"`
starts the compiled service with synthetic data and verifies the web proxy,
runtime, build metadata, assets, terminal pairing QR generation, and the
compiled installation health check. The experimental CI workflow builds and
exercises both architectures; its uploaded artifacts are not published releases.

The embedded web assets, version endpoint, worker, and guest packaging were
checked on Linux x64 and ARM64 using synthetic data. The launcher, runtime and
web API proxy were exercised together on Linux ARM64, and a compiled host
executed the embedded guest through a real disposable container on macOS.
This does not yet prove a full installer, a Linux container sandbox end to end,
or cross-host credential restoration.

The tag-triggered release workflow is set up to test both Linux architectures,
attest the resulting archives, and create a **draft** GitHub release with
checksums. It does not publish the draft. The current source-based installer
does not consume these archives. The binary bundle has an experimental local
installer and an updater that accepts a trusted local bundle, but neither
downloads nor verifies release provenance. Do not publish the draft as a
supported installation path until verification and security review are
complete. Checksums detect accidental
corruption but are not a substitute for independently verified provenance.

For an isolated Linux test machine with systemd, D-Bus, GNOME Keyring,
libsecret, Python 3 and the utilities used by `install.sh`, copy the built
bundle to the machine and run `sudo sh install.sh`. The default browser origin
is `http://127.0.0.1:4320` and the default data directory is
`/var/lib/raphie/data`. `--web-origin` and `--data-dir` override them; existing
data is never overwritten. Existing parents of a custom data directory must be
root-owned and not group- or world-writable. The experimental pairing UI can
be enabled with `--experimental-pairing`; use it only on an isolated test
installation. Access from another machine needs a correctly configured HTTPS
reverse proxy. The installer does not configure one.

For local test bundles, `sudo raphie update /path/to/trusted/bundle` takes an
offline backup before switching. `sudo raphie restore /var/backups/raphie/...`
restores a matching backup after confirmation. These commands have only been
exercised with synthetic data in a disposable Ubuntu container and on an
Ubuntu VM using real systemd and temporarily extracted keyring dependencies.
Portable key recovery and independent release verification remain untested;
do not rely on this for production. A failed install may require manual
cleanup.
