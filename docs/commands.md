# Installed service commands

For the no-sudo user installation, use `~/.local/bin/raphie start`, `status`, `health`, `auth setup`, and `auth recover`. Re-run the [user installer](user-installation.md#updates-and-recovery) to update. The commands below apply only to the separate Linux system installation.

These commands apply to the Linux standalone installation. Run `raphie --help` for the installed version's help. Commands that change service configuration or data require `sudo`.

| Command                                                             | What it does                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `raphie status`                                                     | Check the local runtime.                                                                                                                   |
| `raphie health`                                                     | Check the runtime and web service.                                                                                                         |
| `raphie port`                                                       | Show the configured local web port; if the service is stopped, `sudo` may be needed.                                                       |
| `sudo raphie set-port PORT`                                         | Change the local web port and restart. Choose an unused port from 1024–65535 other than 4316; update any proxy forwarding to the old port. |
| `sudo raphie origins`                                               | Show primary, local and additional browser origins.                                                                                        |
| `sudo raphie set-origins "https://one.example,https://two.example"` | Replace the additional origins and restart. Pass `""` to clear them; primary and local origins remain.                                     |
| `sudo raphie auth setup`                                            | Create the single administrator interactively.                                                                                             |
| `sudo raphie auth recover`                                          | Reset the administrator password and revoke browser and device sessions.                                                                   |
| `sudo raphie update [version\|bundle]`                              | Update to the latest stable release, an explicit version, or a trusted local bundle directory.                                             |
| `sudo raphie restore BACKUP`                                        | Restore a backup and its matching installed release after confirmation.                                                                    |
| `sudo raphie recovery-key export RECIPIENT FILE`                    | Export the keyring unlock credential encrypted to a native age recipient.                                                                  |
| `sudo raphie uninstall`                                             | Remove the service and programs after confirmation; preserve data, configuration, keyrings, backups and the service user.                  |
| `sudo raphie uninstall --purge`                                     | Also delete Raphie data, configuration, keyrings and backups after separate confirmation.                                                  |

`set-origins` takes exact lowercase origins without paths or spaces; non-loopback origins require HTTPS and a separately configured TLS proxy. Use a non-default port in the origin when needed, and omit default ports. Each origin has its own browser sign-in session. These commands do not configure a proxy.

The system updater does not compare the target version to the installed version. Check the version before updating: installing older binaries against newer data can be unsafe. A bare update chooses the latest **stable** release. Specify an alpha or beta tag, for example `sudo raphie update v0.0.4-alpha.2`. Updates stop the service and create an offline backup before switching; long-running work can be interrupted. Restore supports `--recovery-key ENCRYPTED --identity AGE_IDENTITY` for cross-host recovery. Read [backup and recovery](standalone-build.md#cross-host-credential-recovery) before relying on it.

Manage the installed service with `sudo systemctl start raphie`, `sudo systemctl stop raphie`, or `sudo systemctl restart raphie`. Read logs with `sudo journalctl -u raphie -e`. The installer starts and enables the service automatically.

Run `sudo raphie <command> --help` for update, restore, recovery-key, uninstall, set-port and origin command details. Source checkouts use a different CLI: see [source setup](source-setup.md).
