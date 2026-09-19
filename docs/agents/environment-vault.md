# Environment Vault

## Read when

Read before changing Project registration, Profile editing, environment persistence, CLI execution, import/export, or `.env`/Worktree behavior.

## Role in the system

The Environment Vault is the shared domain module behind Raphie's GUI and CLI. It owns Project and Profile resolution, encrypted value storage, profile editing, and secure injection of a selected Profile into a launched process. The Vault is the source of truth; repositories and Worktrees do not receive `.env` files from Raphie.

This is an accepted design contract. The current migration introduces the password-backed local Vault and Vault-backed GUI Projects first; the remaining CLI execution and portable bundle surfaces are tracked separately.

## Canonical terms

Use the definitions in [`CONTEXT.md`](../../CONTEXT.md): **Project**, **Project ID**, **Project handle**, **Profile**, **Vault**, **Worktree**, and **EnvVar**.

## Invariants

- Normal operation never creates, reads, updates, or symlinks a Project or Worktree `.env` file. The only exception is an explicit one-time import prompt when a newly registered Project already contains `.env`.
- An explicit `.env` import parses the source in the application process, encrypts the resulting Profile snapshot, and only then deletes the source when the user selected deletion. Values must never be printed or logged.
- The Vault stores complete, independently editable Profile snapshots. Profiles do not inherit from or overlay other Profiles.
- An EnvVar is a string key/value pair. Values are masked in normal UI and CLI output.
- Secret values must not appear in command arguments, logs, error messages, status output, or generated files.
- `raphie run` injects the selected Profile into the launched process and preserves the command's exit status, signals, standard input, standard output, and standard error.
- `raphie run` executes in the caller's current working directory unless a future command explicitly requests another directory. Selecting `--project` does not implicitly change directories.
- Project resolution fails closed when no Project matches or multiple Projects match. Raphie must not silently load a different Project's values.
- Import/export is explicit and uses an encrypted portable bundle. Copying the local SQLite database is not the portability contract.

## Relationships and boundaries

- A **Project** owns one or more **Profiles**.
- A **Profile** owns a complete snapshot of its EnvVars.
- A **Project** may have multiple local location bindings, including Git Worktrees. Location bindings are machine-local metadata and are not environment values.
- The GUI and CLI are callers of the Vault module; they do not read SQLite tables or perform encryption directly.
- SQLite persistence is an adapter behind the Vault's persistence seam. The local Vault derives its encryption key from the user's password with a stored random salt; the password itself is never persisted. Portable export/import uses a separate encrypted bundle passphrase rather than copying the local database.
- The process launcher receives a resolved environment from the Vault and owns child-process lifecycle. It must not write a temporary environment file.

## State model

The local Vault is either locked or unlocked.

- On first launch, when no Vault record exists, the GUI asks the user to create a password and initializes one local `vault.sqlite` database.
- On later launches, the persisted Vault is treated as locked until the user enters the password again, even if the previous process left the database lock marker unlocked.
- A locked Vault may report that it is unavailable, but operations requiring Profile values must fail without attempting plaintext recovery.
- Unlocking authorizes value reads and writes for the current Vault session.
- Locking removes the Vault's active decryption capability from the runtime as far as the platform permits.
- The auto-lock policy and session lifetime are not yet settled.

## Project resolution

`raphie run` accepts an optional Project handle and Profile name:

```text
raphie run [--project HANDLE] [--profile NAME] -- COMMAND [ARGS...]
```

- With `--project`, resolve the exact unique Project handle. The command still runs from the caller's current directory.
- Without `--project`, resolve the current directory against registered Project locations and, where applicable, Git Worktree identity.
- If `--profile` is omitted, use the Project's explicitly configured default Profile. If no default exists, fail and ask the user to choose one.
- A Project handle is never inferred from an arbitrary folder basename when that could be ambiguous.

## Proposed CLI surface

The command names below describe the contract; exact flag spelling can change without changing the behavior.

| Command | Contract |
| --- | --- |
| `raphie run ... -- COMMAND` | Resolve a Project and Profile, decrypt the snapshot, inject it into `COMMAND`, and return the command's result. |
| `raphie project add PATH --handle HANDLE` | Register a Project location and stable CLI handle. |
| `raphie project list` | List Projects and handles without revealing values. |
| `raphie profile create NAME` | Create an empty Profile for a Project. |
| `raphie profile list` | List Profile names and metadata without revealing values. |
| `raphie env set KEY` | Prompt securely for a value and update the selected Profile. A value flag is not the primary interface because shell history and process listings can expose it. |
| `raphie env set KEY --from-stdin` | Read a value from standard input without echoing it. |
| `raphie env delete KEY` | Remove an EnvVar from the selected Profile after explicit confirmation. |
| `raphie export ... --output FILE` | Write an encrypted portable bundle; never write plaintext values or print them to stdout. |
| `raphie import --input FILE` | Decrypt and validate a bundle, then explicitly attach or merge it into the local Vault. |
| `raphie vault lock\|unlock\|status` | Manage and inspect Vault availability without printing values. |

`load` and `unload` are not the primary process model because an external executable cannot mutate its parent shell's environment. An interactive `raphie shell` or an explicitly documented shell integration may be added later.

## Runtime environment

The selected Profile is resolved entirely in memory and passed directly to the child process. The baseline environment needed by the shell and operating system remains available; Profile values override matching keys.

The recommended leakage-prevention policy is to remove Project-managed keys from the baseline before overlaying the selected Profile, so a value exported by the caller cannot silently survive a Profile switch. The exact definition and lifecycle of “Project-managed key” remains open and must be settled before implementing the launcher.

## Portable export/import

An export is a versioned, encrypted bundle rather than a copy of the local database. It contains the selected Project handle and Profile snapshots, but not machine-specific path or Worktree bindings by default.

- Export encryption must be independent of the source machine's OS keychain.
- Passphrases or recipient keys are entered through secure prompts or files explicitly designated for that purpose, never ordinary command arguments.
- Import re-encrypts values into the destination machine's local Vault.
- Existing Project/Profile conflicts fail by default; merge or replace must be explicit.
- The portable cryptographic format must use a maintained standard and must not be custom-designed by the application.

## Failure contract

The CLI should provide stable non-zero failure categories for at least:

- Vault locked or unavailable
- Project not found
- Project resolution ambiguous
- Profile not found or no default Profile configured
- Invalid or duplicate EnvVar key
- Import decryption or validation failure
- Import conflict requiring an explicit merge/replace choice
- Target command unavailable or unable to start

Failure output must identify the action and remediation without including any environment value.

## Source map

| Concern | Current or planned authoritative source |
| --- | --- |
| Domain language | [`CONTEXT.md`](../../CONTEXT.md) |
| Architectural rationale | [`docs/adr/0004-encrypted-vault-profiles.md`](../adr/0004-encrypted-vault-profiles.md) |
| Legacy Project persistence | `src/core/ProjectsFile.ts` — replace with Vault persistence |
| Legacy env-file persistence | `src/core/envVarFile.ts`, `src/core/listEnvVars.ts`, `src/core/setEnvVar.ts` — replace with Profile operations |
| Legacy Worktree linking | `src/core/worktreeEnvFile.ts`, `src/core/linkWorktree.ts`, `src/core/unlinkWorktree.ts` — remove from the new domain model |
| GUI integration | `src/app/App.tsx` and related components — migrate to Project/Profile operations |
| Verification | `tests/core/` and `tests/app/`, extended with Vault, CLI, resolution, and security-contract tests |

## Change impact

When changing Vault or Profile behavior, also inspect:

- Project and Worktree resolution
- GUI Profile selection and editing
- CLI process-launch and exit-code handling
- encryption-key and portable-bundle adapters
- migration behavior for existing central `.env` files
- ADR-0001, which records the superseded file/symlink architecture

## Related decisions

- [`ADR-0004`](../adr/0004-encrypted-vault-profiles.md) — encrypted Vault Profiles and process-scoped execution
- [`ADR-0001`](../adr/0001-central-file-symlink-architecture.md) — superseded central-file architecture

## Open ambiguities

- Which exact keys are considered Project-managed, and whether absent keys in a Profile must be explicitly removed from the inherited process environment.
- How Git identity and registered paths behave when a Project is cloned, moved, or attached to a new machine.
- The portable bundle cryptographic format and key-rotation policy.
- Vault auto-lock timing and whether background GUI sessions keep the Vault unlocked.
