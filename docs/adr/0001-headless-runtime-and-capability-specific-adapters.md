# Headless runtime with capability-specific adapters

Raphie owns sessions, execution, tools, and approvals in a headless runtime;
clients and messaging-channel adapters use shared application operations. This
keeps behavior and recovery consistent without requiring Discord or Telegram to
reproduce the web workspace's inspection UI. Activity, usage, and diagnostics
inspection belong to capable clients; cross-channel continuation is deferred.

The runtime remains a self-hosted modular monolith with one owner of its durable
store. Sessions have transport-independent identity, and channel bindings and
delivery routing are separate concerns. This avoids coupling each new adapter to
Discord-specific session fields or starting an executor inside every client.

These principles are accepted. The target interfaces and migration sequence in
[headless-runtime.md](../headless-runtime.md) are a design to implement, not a
claim that the current runtime already exposes them.
