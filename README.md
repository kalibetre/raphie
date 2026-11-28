<p align="center">
  <img src="apps/web/src/shared/favicon.svg" alt="Raphie logo" width="112">
</p>

<h1 align="center">Raphie</h1>

<p align="center"><strong>Your assistant. Your space.</strong><br>
A personal AI assistant you run yourself, with a place for every conversation, bot, and idea.</p>

<p align="center">Linux &amp; macOS (Apple Silicon) · Self-hosted · No Bun required</p>

<p align="center"><a href="#get-raphie-running">Get started</a> · <a href="#a-little-more-room-to-think">What Raphie can do</a> · <a href="https://raphie-docs.kalibetre.dev/">Documentation</a></p>

## Get Raphie running

Install Raphie for your user on Linux (x64 or ARM64) or a Mac with Apple Silicon. You need `curl` and `python3`, plus an available OS credential store for desktop mode. Linux desktop mode requires a Secret Service provider such as an unlocked GNOME Keyring or KWallet. On a headless Linux server, pass `--headless` to the installer to use an owner-only master-key file outside app data; see [headless setup](https://raphie-docs.kalibetre.dev/start/installation/#install-raphie).

```sh
curl -fsSL https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh | bash
```

The default channel is **stable**. Check the [published releases](https://github.com/kalibetre/raphie/releases) for a stable release with an archive for your operating system and architecture. If no matching stable release is available, installation stops. To opt into nightly builds instead:

```sh
curl -fsSL https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh | bash -s -- --channel nightly
```

The selected channel is remembered for updates. Use `raphie channel stable` or `raphie channel nightly` to switch. The installer executes code downloaded from GitHub; [download and inspect it first](https://raphie-docs.kalibetre.dev/start/installation/#install-raphie) if you prefer.

The installer configures PATH for new Bash/Zsh terminals and attempts to start a user service. Open a new terminal and run `raphie health` to check that the runtime and web service are available. If no user service is available, run `raphie start` and leave that terminal open. If the service failed to start, follow the installer's log hint and the [service recovery instructions](https://raphie-docs.kalibetre.dev/operate/service/#manage-the-service).

With Raphie running, create your administrator in a second terminal:

```sh
raphie auth setup
```

Open **http://127.0.0.1:24320** (or the port the installer printed), sign in, and connect a model provider in Settings. On a Mac with Apple Silicon, you can also use the [Raphie Mac app](https://raphie-docs.kalibetre.dev/guides/desktop/). See [installation and service setup](https://raphie-docs.kalibetre.dev/start/installation/) for background service requirements, remote access and troubleshooting.

## A little more room to think

- **Make it yours.** Create bots with their own personality, model settings and memory.
- **Keep the thread.** Return to conversations and see activity as work progresses.
- **Stay in control.** Review tool requests and connect the services you choose.

Raphie can also connect bots to Telegram, Discord, Slack and MCP tools, and run scheduled prompts. Bots share a runtime; their separate configuration does not provide isolation from the host owner.

## Need a hand?

[Installation](https://raphie-docs.kalibetre.dev/start/installation/) · [Mac app](https://raphie-docs.kalibetre.dev/guides/desktop/) · [Remote access](https://raphie-docs.kalibetre.dev/operate/remote-access/) · [Commands](https://raphie-docs.kalibetre.dev/operate/commands/) · [Bots & personality](https://raphie-docs.kalibetre.dev/guides/bots/) · [Memory](https://raphie-docs.kalibetre.dev/guides/memory/) · [All documentation](https://raphie-docs.kalibetre.dev/) · [How it works](https://raphie-docs.kalibetre.dev/architecture/overview/)

Want to contribute or run from source? See [source setup](https://raphie-docs.kalibetre.dev/start/installation/#install-raphie) and [contributing](CONTRIBUTING.md).
