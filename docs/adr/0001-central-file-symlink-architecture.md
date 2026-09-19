---
status: superseded by ADR-0004
---

# Central env file + manual symlink for linked Worktrees

We need to share env values across a project's git worktrees. We evaluated varlock (`.env.schema`-based, type-checked, validated) and rejected it: it assumes no `.env` exists and expects values copied/generated per consumer, which doesn't fit a docker-compose workflow that just wants one real `.env` per worktree with no drift between copies. Instead, each Project has one Central env file (plain string key=value, no schema, no types) stored outside the repo; a linked Worktree's `.env` is a symlink to it, created by an explicit, user-triggered Link action (no auto-detection or file watching). This trades away type validation and per-worktree override support (deferred) for zero copying and zero drift by construction — editing one value updates every linked Worktree instantly.

Unlinking is an explicit opt-out from that sharing model: the user must choose either a standalone snapshot of the Central env values or removal of `.env`. Copy mode is intentionally allowed even though copied env files can drift, because the user has explicitly chosen standalone Worktree behavior.

**Considered**: varlock/schema-based generation (rejected — solves a problem we don't have, adds type/schema maintenance for no benefit here); copied `.env` files as the normal Worktree strategy (rejected — reintroduces the drift problem the symlink approach exists to avoid; retained only as an explicit unlink escape hatch).
