# Research retirement — 2026-10-21

The product no longer depends on the original Eve/microsandbox experiments or
the gateway spike. Removed `research/`: experimental sources, old dependency
lockfiles and node_modules, reports, raw run logs, and host inspection output.
Tracked experiment history remains available in Git.

## Configuration

The root `.env.schema` previously imported the gateway spike directory. Its
active settings now live directly in the root schema. The existing private
`research/spikes/gateway/.env` was moved unchanged to the root `.env`, mode 0600.
No secret values were read, rewritten, or committed. Varlock's masked effective
configuration matched before and after the move. The unused research-only MCP
probe settings were not carried into the active schema.

Bun's automatic dotenv loading remains disabled. Varlock still owns runtime
configuration and redaction. New installations can use a root `.env.local` or
process environment values with the tracked schema.

## Legacy data

An orphaned Node gateway was still serving port 4315 with its database open under
research. Confirmed no pending turns or tool approvals, then stopped that legacy
process. The current Bun runtime/web services on 4316/4320 remain independent.

Before removal, archived research to `.data/backups/research-20261021.tar.gz`,
mode 0600, excluding disposable node_modules directories. Verified that the
archive includes the original private configuration and legacy SQLite database.
The stopped server's database and attachments are preserved together. The archive
is private, local, and covered by `.data/` in `.gitignore`.

The active `.data/gateway.sqlite`, attachments, and earlier backups were not
changed or merged. Earlier cleanup/migration notes describe the tree as it
existed at their dates; this retirement supersedes those historical paths.

## Validation

`bun run validate` passed formatting, architecture rules, lint, TypeScript 7,
all 39 tests, and both production bundles after research removal. No active
application code or tooling configuration references the retired directory.
Varlock's masked effective configuration remained identical after migration.

The active runtime responded successfully and retained one session/seven turns.
Port 4320 was not listening during the final check; started only the built web
service with `bun run start:web`, leaving the running agent runtime untouched.
The old Node process on 4315 is stopped. No VM changes or model calls were made.
