# Raphie

Raphie is a self-hosted personal AI assistant. It keeps conversations and work on your own runtime, with a web interface for chatting, configuring bots, reviewing tool approvals and inspecting activity. You connect your own model provider.

Each bot has its own personality, conversations, provider configuration and memory. Bots share one runtime; separate bot configuration does not imply separate machines or a security boundary against the host owner. Raphie can also connect bots to Discord and MCP tools, and run scheduled prompts. See [bots](docs/bots.md) and [automation](docs/bot-automation.md) for details and limitations.

## Install on Linux

An **experimental alpha** binary is available for Debian and Ubuntu systems with systemd on x64 and ARM64. It installs a local service and does not require Bun. Download and inspect both installer scripts from the release tag before running them; the installer does not verify downloaded release provenance or checksums. Follow the [installation guide](docs/linux-installation.md) for the commands, prerequisites, remote access, updates and recovery.

## Run from source

You need [Bun](https://bun.sh/) 1.4.4 (pinned in `.bun-version`) and an OS credential store supported by the runtime. See [credential storage](docs/provider-credential-storage.md) for platform requirements.

```sh
git clone https://github.com/kalibetre/raphie.git
cd raphie
bun install --frozen-lockfile
bun run dev
```

In a second terminal, create the administrator interactively:

```sh
bun run raphie auth setup
```

Open **http://127.0.0.1:4320** and sign in. The web server and runtime listen on loopback ports 4320 and 4316 respectively. In Settings, expand your bot and configure a provider connection and default model; provider keys are entered there, not loaded from environment variables. See [authentication](docs/authentication.md) for password recovery and device authorization.

Source configuration is loaded through Varlock using `.env.schema` and optional private `.env` or `.env.local` files. The app stores its data in `.data/` by default. See [using Raphie](docs/using-raphie.md) for storage, settings and backup details.

For a production web bundle from source, run `bun run build` followed by `bun run start`. Use a process supervisor if you need automatic restarts. To validate a checkout, run `bun run validate`; see [contributing](CONTRIBUTING.md) for development and test workflows.

## Documentation

The [documentation index](docs/README.md) links to installation, usage, operations, architecture and project decisions. Useful starting points:

- [Using Raphie](docs/using-raphie.md) — conversations, settings and data.
- [Linux installation](docs/linux-installation.md) — alpha installation and service operation.
- [Bots and personality](docs/bots.md), [memory](docs/memory.md), and [automation](docs/bot-automation.md).
- [Architecture](docs/architecture.md) and [contributing](CONTRIBUTING.md).
