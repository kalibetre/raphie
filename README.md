<p align="center">
  <img src="apps/web/src/shared/favicon.svg" alt="Raphie logo" width="112">
</p>

<h1 align="center">Raphie</h1>

<p align="center"><strong>Your assistant. Your space.</strong><br>
A personal AI assistant you run yourself, with a place for every conversation, bot, and idea.</p>

<p align="center">Linux &amp; macOS · Experimental alpha · No Bun required</p>

<p align="center"><a href="#get-raphie-running">Get started</a> · <a href="#a-little-more-room-to-think">What Raphie can do</a> · <a href="#need-a-hand">Documentation</a></p>

## Get Raphie running

Install Raphie for your user on Linux or macOS. You need `curl`, `python3` and an available OS credential store. Linux requires a Secret Service provider such as an unlocked GNOME Keyring or KWallet.

```sh
curl -fsSL https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh | bash
```

The installer selects the latest stable release, or the latest alpha if no stable release is available. To install a particular release, append `-s -- v0.0.4-alpha.2` to `bash`. The installer executes code downloaded from GitHub; [download and inspect it first](docs/user-installation.md) if you prefer.

Once installed, open a terminal and create your administrator:

```sh
raphie auth setup
```

Open **http://127.0.0.1:4320**, sign in, and connect a model provider in Settings. The installer attempts to start a user service; if it cannot, run `raphie start` in a terminal first. See [installation and service setup](docs/user-installation.md) for background service requirements, remote access and troubleshooting.

## A little more room to think

- **Make it yours.** Create bots with their own personality, model settings and memory.
- **Keep the thread.** Return to conversations and see activity as work progresses.
- **Stay in control.** Review tool requests and connect the services you choose.

Raphie can also connect bots to Discord and MCP tools, and run scheduled prompts. Bots share a runtime; their separate configuration does not provide isolation from the host owner.

## Need a hand?

[User installation](docs/user-installation.md) · [Linux system service](docs/linux-installation.md) · [Remote access](docs/standalone-build.md#tailnet-access) · [Commands](docs/commands.md) · [Bots & personality](docs/bots.md) · [Memory](docs/memory.md) · [All documentation](docs/README.md)

Want to contribute or run from source? See [source setup](docs/source-setup.md) and [contributing](CONTRIBUTING.md).
