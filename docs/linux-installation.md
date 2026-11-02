# Install and run Raphie on Linux

The standalone release is an **experimental alpha** for Debian and Ubuntu with systemd, on x64 or ARM64. You need an internet connection, `sudo`, and a free local web port. The release includes the runtime; you do not need Bun or GitHub CLI.

> [!WARNING]
> The installer runs as root. It downloads releases over HTTPS but does not verify checksums or provenance. Download and inspect the script before running it. Use this alpha on a machine you are comfortable experimenting on; a failed installation may require manual cleanup.

## 1. Download the installer

On the machine that will run Raphie:

```sh
mkdir raphie-install && cd raphie-install
curl -fsSLO https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/linux-binary/bootstrap.sh
less bootstrap.sh
```

The installer above comes from the current main branch. To install a later published alpha, use its explicit tag in the command below. Without a version, the installer selects the latest **stable** release; alphas must be selected explicitly.

## 2. Install and create your account

```sh
sudo sh bootstrap.sh v0.0.4-alpha.2
sudo raphie auth setup
```

The installer installs OS dependencies, creates a `raphie` service user and starts the systemd service. It refuses to overwrite an existing installation, service user or data directory. Account setup prompts for an email and password; see [authentication](authentication.md).

By default the web service listens on `127.0.0.1:41837`, and data is stored in `/var/lib/raphie/data`. The runtime also listens on loopback; keep its port private. To choose a different port or data directory at installation:

```sh
sudo sh bootstrap.sh v0.0.4-alpha.2 --web-port 41838 --data-dir /srv/raphie-data
```

The port must be 1024–65535, available, and different from 4316. The data path must be absolute, must not already exist or contain symlinks, and its existing parents must be root-owned and not group- or world-writable. See `sudo sh bootstrap.sh --help` for options.

## 3. Sign in

On the same machine, open **http://127.0.0.1:41837** (or your chosen port). Sign in, open Settings, expand your bot, add a model provider connection and select a default model.

If Raphie runs on a remote server, create an SSH tunnel from your own computer, replacing `you@your-server`:

```sh
ssh -L 41837:127.0.0.1:41837 you@your-server
```

Leave the tunnel open and visit http://127.0.0.1:41837 on your computer. If you chose another server port, adjust both port numbers. For access over HTTPS, see [remote access and origins](standalone-build.md#tailnet-access). A non-loopback browser origin requires a trusted TLS-terminating proxy; the runtime itself must remain on loopback.

## Operate and update

```sh
raphie status                 # runtime status
raphie health                 # runtime and web health
raphie port                   # configured web port
sudo systemctl restart raphie # restart the service
sudo journalctl -u raphie -e # service logs
```

Use `sudo raphie update v0.0.4-alpha.2` to select an alpha explicitly. `sudo raphie update` selects the latest stable release. An update stops the service, makes an offline backup and restarts it; running work can be interrupted. See the [command reference](commands.md) for origins, ports, updates, restore and uninstall.

## Backups and recovery

Updates write a backup under `/var/backups/raphie/` and retain the matching release. If the new release fails to start, the updater stops the service and prints the backup location. Database migrations may be irreversible: restore a consistent backup and its matching release rather than starting an older version against newer data.

```sh
sudo raphie restore /var/backups/raphie/raphie-XXXXXXXX.tar
```

Restore requires confirmation and preserves replaced data and keyrings. Backups contain sensitive data, including authentication secrets and encrypted keyrings. The normal backup does **not** contain the host-bound credential needed to unlock those keyrings on another host. Prepare and test [cross-host recovery](standalone-build.md#cross-host-credential-recovery) separately; root access to the host can recover its credentials.

For service troubleshooting, installation options, HTTPS, recovery and the limits of the alpha, see [standalone installation and operations](standalone-build.md).
