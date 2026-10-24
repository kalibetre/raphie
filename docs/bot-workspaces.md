# Durable lightweight bot workspaces

Each bot has one virtual `/workspace`, shared by its sessions. Ask the bot to
write a note or process files with `workspace_exec`. The tool takes only a command;
bot ownership and session identity come from the admitted turn. Other bots have
separate stores and cannot select this workspace through tool arguments.

The runtime interprets supported shell syntax using pinned just-bash 3.6.0 in a
disposable worker. It installs no host filesystem mounts, inherited environment,
network, Python, JavaScript, native shell or SQLite command. Credential-bearing
MCP integrations remain host-side tools with their existing approval policy.
This is logical separation and bounded interpretation, **not OS or VM isolation**.
The process account and installed dependency code remain trusted.

Only virtual `/workspace` files are durable; `/tmp` and other virtual paths are
scratch. Every execution starts in `/workspace` with fresh shell variables and
process state. Supported files, directories, permissions, timestamps and symlinks
are checkpointed. Binary content is preserved. Hard links are materialized as
independent files between executions. Symlinks refer only to the virtual
filesystem; links to scratch files become dangling after an execution.

Executions are queued in admission order within a bot, including across its
sessions. Different bots can execute concurrently. A shell exit of zero commits
the files; a nonzero exit, worker failure, interruption, limit breach or timeout
discards that execution's changes. A command can handle a normal command error
and exit zero, as in a shell. Inspect `exitCode` and `committed` before claiming
success. Local workspace edits need no separate tool approval; they cannot
perform an external service action.

## Checkpoints and recovery

The host owns `<bot-data>/workspace/checkpoint.sqlite`, outside the worker. It is
not a mounted guest file. The directory is private and the database is owner-only.
Do not edit it while the bot is running. Back it up with the other bot stores.
The successful checkpoint and a stable execution receipt commit in one SQLite
transaction. A recovered tool call reuses its receipt instead of repeating an
append or other file edit. Conflicting retries are rejected. Receipt IDs are
host-derived and include the tool task/call and conversation identities.

Restart starts from the last committed checkpoint. Interrupted computation has no
external side effects and may safely run again from that checkpoint if Pi resumes
its tool task. Opening a replacement workspace executor increments a persistent
generation. Older executors and their queued requests cannot commit after that
point. A worker receives copies of files and can only return a candidate
checkpoint; it cannot write durable storage. This does not permit two runtime
processes to own the same Gateway store: stop the old runtime before upgrading.

## Bounds

- Five seconds per execution, including worker startup, with an independent host
  deadline that terminates the worker.
- 16 KiB command source, 32 KiB shell output, 8 MiB retained file content,
  1,024 durable entries and 12 MiB serialized checkpoint.
- Hardened just-bash limits plus 2,000 commands/loop iterations and bounded
  expansions, traversals and archive input/output. These are interpreter budgets,
  not an OS-enforced process memory quota.
- At most 16 admitted executions per workspace, including the running operation,
  and four simultaneous lightweight workers across the runtime. Busy capacity
  returns an explicit error; it does not consume model-generation or VM budgets.
- 16 MiB of retained execution receipts and a 32 MiB SQLite page ceiling per bot.
  Receipts are never silently evicted, because eviction could replay old writes.
  At capacity, further operations stop. Owner-managed export/archival and UI file
  browsing are future work; preserve the store and its backups rather than
  resetting receipts. SQLite transaction journal space is additional transient
  disk use. Failed execution outputs also consume receipt space.

The dependency is Apache-2.0. The lockfile pins its dependencies; a scoped override
updates only guarded-fetch's Undici dependency to patched 7.30.1. Existing Undici 6
users stay unchanged. Optional native package install scripts remain blocked;
they are not required for the workspace interpreter.

VM/native escalation, filesystem imports/exports, cross-bot sharing, workspace UI,
OS memory containment, and separate model-generation concurrency policy remain
future work. No VM is reserved per bot or session.

Verification: `bun test packages/runtime/test/bot-workspace.test.ts
packages/runtime/test/workspace-compute.test.ts`. Full gate: `bun run validate`.

Crash acceptance additionally kills a real process during compute and after a
checkpoint commit but before Pi records the tool result. Recovery preserves files
and does not repeat an append. Tests inject a failed checkpoint transaction to
prove the receipt rolls back with the files, and fill the receipt budget to prove
new work stops while committed retries still resolve. Output-format, filesystem
copy, entry-count and timeout probes verify rollback and continued usability.

Final verification on 2026-10-24: `bun run validate` passed (150 tests, architecture,
formatting, lint, type checks and production build). Production dependency audit
returned no findings. An isolated browser verified identity/fixture labels and
keyboard expansion at 320/768/1024/1440 pixels, Backend connection details and
the floating composer, with no page errors or horizontal overflow. User runtimes
and data were not used for testing.
