# Raphie documentation

The guides describe implemented behavior and its limits. Proposed behavior stays
in the roadmap and target-design documents. Update the relevant guide in the same
change that changes the behavior.

## Use and operate Raphie

- [Project overview and release setup](https://github.com/kalibetre/raphie/blob/main/README.md)
- [Run from source](source-setup.md)
- [User installation on Linux and macOS](user-installation.md): no-sudo setup and user services.
- [Linux system installation](linux-installation.md): install, sign in, operate and recover.
- [Installed service commands](commands.md): status, ports, origins, updates and recovery.
- [Standalone builds and operations](standalone-build.md): detailed deployment and recovery notes.
- [Using Raphie](using-raphie.md): conversations, settings, storage and features.
- [Desktop client](desktop.md): the native Rust app, device sign-in, fixture and tailnet connections, limits and Rune notes.
- [Clients: what each one can do](clients.md): which capabilities the web workspace, the desktop client and a later mobile client offer, and why access management stays in the browser.
- [General attachments](general-attachments.md): composer uploads, workspace paths, original versions and model input limits.
- [Bots and personality](bots.md): default identity, isolated configuration, SOUL.md, APIs and recovery limits.
- [Bot workspaces and execution providers](bot-workspaces.md): files, just-bash, containers and their limits.
- [Bot automation](bot-automation.md): per-bot MCP servers, encrypted configuration and recurring prompts.
- [Telegram channel](telegram.md): BotFather setup, owner pairing, delivery limits, security notes and what is unsupported.
- [Memory](memory.md): built-in behavior, agent tools, storage, correction,
  forgetting, provider support and recovery.
- [Administrator authentication](authentication.md): sign-in, setup and recovery commands, protection and limits.
- [Provider credential storage and recovery](provider-credential-storage.md)
- [Observability](observability.md): Activity, Diagnostics and trace storage.
- [Delivered headless HTTP interface](headless-interface.md)

## Understand and extend the system

- [Architecture in diagrams](architecture-overview.html ":ignore"): presentation-ready visual tour,
  one diagram per subsystem.
- [Architecture reference](architecture.html ":ignore"): engineering reference with diagrams for
  topology, durable execution, turns, approvals, bots, memory, sandboxes, extensions, channels and storage.
- [Current architecture](architecture.md)
- [Domain language](https://github.com/kalibetre/raphie/blob/main/CONTEXT.md)
- [Contributing and verification](https://github.com/kalibetre/raphie/blob/main/CONTRIBUTING.md)
- [UI scrolling and composer behavior](ui-scrolling.md)
- [Learning Rust with the desktop client](learning-rust.md): the desktop codebase as a guided Rust lesson, with exercises.
- [Headless runtime decision](adr/0001-headless-runtime-and-capability-specific-adapters.md)
- [Accepted bot ownership and workspace decision](adr/0002-bot-owned-workspaces-and-temporary-compute.md)
- [Native bot sandbox decision](adr/0003-native-bot-sandbox.md): container execution, delivered as opt-in.

## Planned work and history

- [Roadmap](roadmap.md): historical slices and acceptance criteria; some status is outdated.
- [Target headless runtime](headless-runtime.md)
- [Bun migration](bun-migration.md)
- [Repository cleanup record](repository-cleanup.md)

For a new feature guide, link it here and from the relevant section of the root
README. Keep defaults, Settings controls, persistence, failure/recovery behavior,
provider differences and verification instructions aligned with the code. Describe
model-dependent behavior as such; distinguish implemented capabilities from
planned work. Preserve historical documents as records rather than using them as
current product instructions.
