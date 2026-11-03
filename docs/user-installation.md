# Install Raphie for your user

The user installer supports glibc Linux and macOS on x64 and ARM64. Alpine/musl and native Windows are not supported; Windows is deferred. It installs prebuilt binaries in `~/.local/lib/raphie` and a `~/.local/bin/raphie` command. It does not install operating-system packages or require sudo. Install `curl` and Python 3 first, and ensure `~/.local/bin` is on your PATH.

```sh
curl -fsSL https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh | bash
```

The default channel is **stable**. If no stable release exists for your platform, the installer stops without choosing a nightly. To install nightly builds explicitly:

```sh
curl -fsSL https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh | bash -s -- --channel nightly
```

Nightly builds are published from `main` after the automated build and validation pass. macOS binaries are not signed or notarized, and Gatekeeper behavior has not yet been verified. Native Windows is deferred.

Piping a script runs downloaded code immediately. To inspect it first:

```sh
curl -fsSLo install-raphie.sh https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh
less install-raphie.sh
bash install-raphie.sh
```

The installer verifies release archives against the published SHA256SUMS. This detects corruption but does not independently establish provenance. The `main` URL can change; once a release includes the user installer, replace `main` in the URL with its release tag to pin the script. It refuses to overwrite an existing user installation or command, and will not start a new installation against an existing default data directory. A recognized user installation can be updated by rerunning the installer. It does not migrate an existing system installation; both use the same default runtime port, so stop the other instance before starting this one. Data is never moved automatically.

## First run

Run `~/.local/bin/raphie auth setup` in a terminal and create the administrator, then sign in at http://127.0.0.1:4320. Configure a model provider and a default model under your bot in Settings. If no user service is available, run `~/.local/bin/raphie start` in a terminal and leave it running. If startup fails, use the log hint printed by the installer, fix the underlying issue, then re-enable the service as described below. `raphie status` checks the local runtime; `raphie auth recover` resets the password and signs out all sessions.

Raphie stores provider credentials using the current user's OS credential store. On macOS, unlock the login Keychain and allow access if prompted. Linux needs libsecret and an unlocked Secret Service provider in the user's D-Bus session. A headless machine without one cannot start the runtime; see [credential storage](provider-credential-storage.md). The installer does not install system packages. For an explicitly opted-in headless setup, see below.

## Headless Linux

For a Linux host without an unlocked desktop Secret Service, opt into a dedicated keyring and an automatically readable unlock key:

```sh
curl -fsSL https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh | bash -s -- --headless --channel nightly
```

Omit `--channel nightly` for a stable installation. On an existing user installation, rerun with `--headless` to configure its service. This requires `dbus-run-session`, `gnome-keyring-daemon`, libsecret and a systemd user manager. It refuses to switch an existing encrypted settings database from a different credential store; migration is not automatic.

The randomly generated unlock key and private keyring live in `~/.local/share/raphie-headless`, separate from Raphie data. The unlock key is readable by your account (mode 0600); anyone who can read both the key and keyring can unlock the stored master key. Protect and back up that directory separately from the Raphie data backup. Losing either makes saved provider credentials unrecoverable. No sudo is required for setup. The installer tries to enable user lingering so the service can start at boot and stay running after logout. Some hosts require administrator authorization for `loginctl enable-linger "$USER"`; if that attempt fails, the installer prints a warning and boot-time startup is not enabled.

## Background service

On Linux, if a systemd user manager is available, installation creates and starts `~/.config/systemd/user/raphie.service`. Manage it with `systemctl --user status raphie`, `systemctl --user restart raphie`, and `journalctl --user -u raphie -e`. User services may stop when you log out; enabling lingering is a separate host-administrator operation. The user manager must have access to `DBUS_SESSION_BUS_ADDRESS` and an unlocked Secret Service. If the installer stopped an unhealthy unit, use `systemctl --user enable --now raphie` after fixing the cause. If no user manager is available, run `~/.local/bin/raphie start` in a terminal or configure your own supervisor.

On macOS, installation creates a per-user LaunchAgent at `~/Library/LaunchAgents/com.raphie.user.plist` when a GUI launchd session is available. Logs are under `~/Library/Logs/Raphie`. A login Keychain may need to be unlocked before the service can use provider credentials. If the installer disabled an unhealthy agent, re-enable it with `launchctl enable "gui/$(id -u)/com.raphie.user"`, then run `launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.raphie.user.plist"`. If launchd is unavailable, run `~/.local/bin/raphie start` in a terminal.

Data defaults to `~/.local/share/raphie` on Linux (or `$XDG_DATA_HOME/raphie` when set to an absolute path) and `~/Library/Application Support/Raphie` on macOS. Browser access and the runtime bind to loopback. For remote use, run `ssh -L 4320:127.0.0.1:4320 you@your-server` on your computer and open `http://127.0.0.1:4320`, or configure a trusted HTTPS proxy and allowed origin; the runtime port must stay local. See [remote access](standalone-build.md#tailnet-access) for the concepts; its `sudo raphie` commands apply to the separate system installation, not this user installer.

## Updates and recovery

Re-run the installer to update a recognized user installation. It remembers the selected channel: stable updates follow stable releases; nightly updates follow nightly builds. Run `raphie channel` to see your channel and `raphie channel stable` or `raphie channel nightly` to change it. Alternatively, re-run the installer with `--channel stable` or `--channel nightly` to switch and check for an update in one step.

A channel switch is saved immediately. If the selected release does not contain the currently installed commit, the installer leaves the running version unchanged and waits for a safe release. It checks release ancestry with the GitHub API before replacing binaries; if it cannot verify ancestry, it refuses the update. Existing installations without a saved channel default to stable. Historical alpha and beta releases remain accessible as existing installations but are not selected by either channel. It stops its managed service, refuses to proceed if either Raphie port is still in use, and copies the stopped data directory to `~/.local/share/raphie-backups/` before replacing binaries. Previous binaries are retained in `~/.local/lib/.raphie-previous.*`. Stop a foreground `raphie start` yourself before updating. Keep the same `XDG_DATA_HOME` used at installation; the installer refuses to guess if it has changed.

A backup contains sensitive data. It does not include the matching OS credential-store key: preserve that separately as described in [credential storage and recovery](provider-credential-storage.md). Database migrations may be irreversible. If an update fails after startup, stop the service, preserve the current data, then restore the offline data backup and its matching previous binaries together; do not run old binaries against newly migrated data. The installer stops an unhealthy service and prints the relevant log location.

The user installation does not yet provide an uninstall command or automated off-host backups.
