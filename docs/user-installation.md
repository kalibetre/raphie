# Install Raphie for your user

The user installer supports Linux and macOS on x64 and ARM64. It installs prebuilt binaries in `~/.local/lib/raphie` and a `~/.local/bin/raphie` command. It does not install operating-system packages or require sudo. Install `curl` and Python 3 first, and ensure `~/.local/bin` is on your PATH.

```sh
curl -fsSL https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh | bash
```

The script selects the latest stable GitHub release, or the latest alpha when no stable release exists. Select a particular published release with `bash -s -- v0.0.4-alpha.2`. macOS binaries first become available with the release that includes the macOS build; earlier alpha releases only contain Linux binaries.

Piping a script runs downloaded code immediately. To inspect it first:

```sh
curl -fsSLo install-raphie.sh https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh
less install-raphie.sh
bash install-raphie.sh
```

The installer downloads release archives over HTTPS but does not verify their checksums or provenance. It refuses to overwrite an existing user installation or command, and will not start against an existing default data directory. It does not migrate an existing system installation; both use the same default runtime port, so stop the other instance before starting this one. Data is never moved automatically.

## First run

Run `raphie auth setup` in a terminal and create the administrator, then sign in at http://127.0.0.1:4320. Configure a model provider and a default model under your bot in Settings. If the user service could not start, run `raphie start` in a terminal and leave it running. `raphie status` checks the local runtime; `raphie auth recover` resets the password and signs out all sessions.

Raphie stores provider credentials using the current user's OS credential store. On macOS, unlock the login Keychain and allow access if prompted. Linux needs libsecret and an unlocked Secret Service provider in the user's D-Bus session. A headless machine without one cannot start the runtime; see [credential storage](provider-credential-storage.md). The installer does not install or unlock a credential service.

## Background service

On Linux, if a systemd user manager is available, installation creates and starts `~/.config/systemd/user/raphie.service`. Manage it with `systemctl --user status raphie`, `systemctl --user restart raphie`, and `journalctl --user -u raphie -e`. User services may stop when you log out; enabling lingering is a separate host-administrator operation. If no user manager is available, run `raphie start` in a terminal or configure your own supervisor.

On macOS, installation creates a per-user LaunchAgent at `~/Library/LaunchAgents/com.raphie.user.plist` when a GUI launchd session is available. Logs are under `~/Library/Logs/Raphie`. If it cannot start, use `raphie start` in a terminal. A login Keychain may need to be unlocked before the service can use provider credentials.

Data defaults to `~/.local/share/raphie` on Linux (or `$XDG_DATA_HOME/raphie` when set to an absolute path) and `~/Library/Application Support/Raphie` on macOS. Browser access and the runtime bind to loopback. For remote use, tunnel the web port through SSH, or configure a trusted HTTPS proxy and allowed origin; the runtime port must stay local. See [remote access](standalone-build.md#tailnet-access) for the concepts; its `sudo raphie` commands apply to the separate system installation, not this user installer.

The user installer currently refuses an existing installation. It does not yet provide an in-place update, uninstall or automatic data backup. Preserve the data directory and its matching OS credential-store key; database copies alone cannot recover encrypted provider keys. See [credential storage and recovery](provider-credential-storage.md) for backup limits.
