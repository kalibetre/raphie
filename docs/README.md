# Raphie documentation

The guides describe implemented behavior and its limits. Proposed behavior stays
in the roadmap and target-design documents. Update the relevant guide in the same
change that changes the behavior.

## Use and operate Raphie

- [Run locally, configure Settings and verify the app](../README.md)
- [Bots and personality](bots.md): default identity, isolated configuration, SOUL.md, APIs and recovery limits.
- [Bot automation](bot-automation.md): per-bot MCP servers, encrypted configuration and recurring prompts.
- [Memory](memory.md): built-in behavior, agent tools, storage, correction,
  forgetting, provider support and recovery.
- [Provider credential storage and recovery](provider-credential-storage.md)
- [Observability](observability.md): Activity, Diagnostics and trace storage.
- [Delivered headless HTTP interface](headless-interface.md)

## Understand and extend the system

- [Interactive architecture field guide](architecture.html): offline visual
  walkthrough with implementation and proposal labels.
- [Current architecture](architecture.md)
- [Domain language](../CONTEXT.md)
- [Contributing and verification](../CONTRIBUTING.md)
- [UI scrolling and composer behavior](ui-scrolling.md)
- [Headless runtime decision](adr/0001-headless-runtime-and-capability-specific-adapters.md)
- [Accepted bot ownership and workspace decision](adr/0002-bot-owned-workspaces-and-temporary-compute.md)
- [Proposed native bot sandbox decision](adr/0003-native-bot-sandbox.md)

## Planned work and history

- [Roadmap](roadmap.md): slices, acceptance criteria and outstanding work.
- [Target headless runtime](headless-runtime.md)
- [Bun migration](bun-migration.md)
- [Repository cleanup record](repository-cleanup.md)

For a new feature guide, link it here and from the relevant section of the root
README. Keep defaults, Settings controls, persistence, failure/recovery behavior,
provider differences and verification instructions aligned with the code. Describe
model-dependent behavior as such; distinguish implemented capabilities from
planned work. Preserve historical documents as records rather than using them as
current product instructions.
