<p align="center">
  <img src="apps/web/src/shared/favicon.svg" alt="Raphie logo" width="112">
</p>

<h1 align="center">Raphie</h1>

<p align="center"><strong>Your assistant. Your space.</strong><br>
A personal AI assistant you run yourself, with a place for every conversation, bot, and idea.</p>

<p align="center">Linux x64 &amp; ARM64 · Experimental alpha · No Bun required</p>

<p align="center"><a href="#get-raphie-running">Get started</a> · <a href="#a-little-more-room-to-think">What Raphie can do</a> · <a href="#need-a-hand">Documentation</a></p>

## Get Raphie running

Install the alpha on a Debian or Ubuntu machine with systemd (x64 or ARM64). You’ll need `sudo` access and an internet connection.

> [!WARNING]
> **Experimental alpha.** The installer runs as root and does not verify release checksums or provenance. Inspect the script before running it. See the [installation and recovery guide](docs/standalone-build.md) for limitations.

### 1. Download the installer

Download the installer and read it before running:

```sh
mkdir raphie-install && cd raphie-install
curl -fsSLO https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/linux-binary/bootstrap.sh
less bootstrap.sh
```

### 2. Install and create your account

```sh
sudo sh bootstrap.sh v0.0.4-alpha.2
sudo raphie auth setup
```

Follow the prompts to create your administrator account.

### 3. Open Raphie

On the same machine, visit **http://127.0.0.1:41837** and sign in. In Settings, expand your bot, connect a model provider and choose a model. You’re ready to chat.

On a remote server, run this on your own computer first, then open the same address:

```sh
ssh -L 41837:127.0.0.1:41837 you@your-server
```

For HTTPS and other access options, see [remote access](docs/standalone-build.md#tailnet-access). If you chose a different port, run `raphie port` on the server and use that port instead.

<details>
<summary><strong>Already installed? Update to this alpha</strong></summary>

```sh
sudo raphie update v0.0.4-alpha.2
```

Alpha versions need an explicit tag. See [updates, backups and recovery](docs/standalone-build.md) before updating.

</details>

## A little more room to think

- **Make it yours.** Create bots with their own personality, model settings and memory.
- **Keep the thread.** Return to conversations and see activity as work progresses.
- **Stay in control.** Review tool requests and connect the services you choose.

Raphie can also connect bots to Discord and MCP tools, and run scheduled prompts. Bots share a runtime; their separate configuration does not provide isolation from the host owner.

## Need a hand?

[Installation & updates](docs/linux-installation.md) · [Remote access](docs/standalone-build.md#tailnet-access) · [Commands](docs/commands.md) · [Bots & personality](docs/bots.md) · [Memory](docs/memory.md) · [All documentation](docs/README.md)

Want to contribute or run from source? See [source setup](docs/source-setup.md) and [contributing](CONTRIBUTING.md).
