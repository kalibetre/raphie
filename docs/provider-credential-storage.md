# Provider credential storage

Raphie is a local, single-owner application, run from source under Bun (currently
pinned to 1.4.4). Its independent runtime and web server bind to loopback; the
runtime can also run headlessly for Discord. It is not an individually signed,
sandboxed desktop application. Host/Origin checks protect browser requests, not
against native code running as the owner. Use one runtime per data directory.
Provider keys are entered only in Settings; environment keys are ignored.

## Decision and boundary

Settings schema v4 encrypts each provider key using AES-256-GCM. A random 256-bit
master key lives in the OS credential store by default, under service
`com.raphie.provider-credentials`, account/name equal to the database's random
`keyId`. Explicit headless mode instead uses a private master-key file outside
Raphie data. SQLite stores that non-secret identifier, connection metadata, and each
credential's base64 ciphertext, random 96-bit nonce and 128-bit authentication
tag. Additional authenticated data binds the format, keyId, connection ID and
provider. Nonces are regenerated on every save. Names, defaults and other
settings are not encrypted or protected against malicious modification/rollback.

`CredentialCipher` is the small secret-persistence boundary. The existing provider
and model APIs still receive runtime-only resolved keys. No key enters browser
read responses, conversation documents, or session choices. Stable connection IDs
continue to identify Pi providers, defaults, session choices and favorites.

We evaluated storing every key in the OS store with only references in SQLite.
That avoids application encryption, but add/edit/remove/migration would need a
recoverable protocol across two stores with no shared transaction. Envelope
encryption keeps all connection updates atomic in the existing SQLite row. The
single small master secret also avoids platform credential size limits for
provider keys. Headless installs keep the master file outside the database/data
directory so copying app data alone does not disclose the key. The environment
setting selects a file path; the key itself is never an environment variable.
No new dependency is needed.

## Platforms and locked/unavailable stores

[Bun's native Secrets API](https://bun.sh/docs/runtime/secrets) uses macOS Keychain,
Linux libsecret and Windows Credential Manager. On macOS this uses the login
keychain and may prompt for permission; Raphie does not enable unrestricted access.
On Linux, install libsecret and run an unlocked Secret Service provider (such as
GNOME Keyring/KWallet) in the runtime user's login/D-Bus session, or explicitly
select the file backend described below for an unattended host. Windows requires
Credential Manager; Bun's default persistence can roam with a domain profile. This is user-account storage,
not guaranteed hardware-bound or biometric protection.

On startup, a missing, locked, denied or unavailable store stops startup with a
fixed, actionable error; native error details are suppressed. An existing encrypted
database's missing or malformed master key is never silently replaced. Restore
its corresponding credential-key backup if it was deleted. If the key is
irretrievably lost, encrypted credentials cannot be recovered; databases and
connection IDs are retained. Raphie never automatically falls back between stores.

### Explicit file backend for headless hosts

Set `RAPHIE_CREDENTIAL_KEY_FILE` to an absolute path outside app data, or use
`install.sh --headless` to configure it for the Linux user service. The installer
uses `~/.local/share/raphie-headless/master-key`. No D-Bus session, libsecret or
GNOME Keyring is needed in this mode. Desktop mode is unchanged when the variable
is unset. Empty or invalid paths fail closed.

The file holds one random 256-bit master encoded as base64. It is shared by the
installation's bots and secret stores, while each database retains its own keyId
and authenticated record identities. This does not add cryptographic isolation
between bots against a compromised runtime. The immediate directory must be owned
by the runtime user with mode `0700`; the regular key file must be owned by that
user with mode `0600`. Symlinked directories/files and hard-linked keys are
rejected. Existing files are never overwritten, including malformed files.

A runtime can create the file exclusively for a fresh database if the directory's
parent already exists. After encryption, a missing key aborts startup. The
installer also refuses to regenerate a lost key or switch an existing encrypted
OS-store/experimental-keyring installation automatically. Such migrations need a
separate recovery plan. Store keys and data backups separately, and protect both.
Anyone who can read the key and encrypted databases can decrypt their credentials;
this mode relies on filesystem permissions and does not protect a full account or
disk compromise. See [headless installation](user-installation.md#headless-linux).

The master and resolved credentials are cached for the running process lifetime.
Locking the OS store later does not revoke those copies or stop an existing turn.
Stop Raphie to release the process; restarting while locked fails closed. Closing
zeros the master buffer, but JS strings, SDK closures, heap copies, swap and crash
dumps cannot be reliably zeroed by this application.

## Migration, interruption and removal

Stop other runtimes using the directory before upgrading. Startup uses SQLite's
exclusive writer transaction to read the saved state and migrate legacy plaintext
formats. Version 3 entries retain their IDs, names, enabled state and credentials,
including unconfigured entries. Earlier environment-only entries are discarded
as before; earlier saved keys keep their original `openrouter` identity.

A master is stored and read back from the selected backend before any plaintext row
is replaced. All keys are encrypted into one atomic SQLite update. Failure before
commit leaves the previous row recoverable and prevents serving the runtime.
There is intentionally no plaintext backup made by migration. In OS-store mode,
a crash between key creation and SQLite commit can leave an unused random master
entry; retry creates a new one without overwriting existing masters. File mode
reuses its installation master after an interrupted database commit. Do not
bulk-delete entries from the OS service: other installations/backups may depend
on them.

Startup drains/removes an existing WAL by requiring DELETE journal mode, enables
`secure_delete`, uses memory for temporary tables, commits the encrypted state,
then VACUUMs the settings database before publishing credentials. Failure to obtain
the lock, commit, or clean up aborts startup. Cleanup runs on every startup, so an
interruption after commit retries it against the already encrypted state. Disk-full
or permission failures require fixing storage and restarting. Never downgrade a
v4 database to older code that expects plaintext.

Editing replaces the encrypted value without changing connection identity.
Removing/clearing a key removes its ciphertext from current settings and active
provider registration. SQLite secure deletion remains enabled; DELETE mode avoids
retaining historical WAL frames. The database master is retained for other
connections and backup recovery. Removal is not cryptographic erasure of all
copies: a prior encrypted backup plus its matching master can still recover
removed credentials. Revoke/rotate the provider key when that is required.

## Threats and backups

This addresses accidental plaintext disclosure from SQL inspection, copying the
settings database/data directory, and new database-only backups. Existing `0600`
file permissions and `0700` creation of new directories remain additional Unix
protections against other users. Provider credentials remain redacted in activity
logs, errors and browser responses.

It does **not** prevent arbitrary same-user processes from using the same Bun
executable/credential store, controlling the local runtime API, modifying source,
reading process memory, or using provider credentials through a compromised
runtime. Root/admin compromise is outside this boundary too. OS access controls
can raise barriers, but stronger process isolation needs a separately signed and
sandboxed broker or a separately authenticated remote secret service. FileVault
or equivalent full-disk encryption still matters for offline disk theft.

VACUUM/secure deletion clean SQLite's logical files; they cannot guarantee erasure
from SSD wear-leveling, copy-on-write filesystems, snapshots, swap or old copies.
**Old plaintext databases, WAL/journal copies, archives and backups remain secret.**
Migration never searches for or deletes unrelated backups (including `.data/backups`).
Protect those copies and rotate exposed provider keys; manage backup retention
explicitly. New encrypted backups need the matching master to restore on a new
machine or account. Back up the OS store through supported OS facilities, or
preserve the headless master file with owner-only permissions, separately from
SQLite; never export a plaintext master beside the database. Restoring an
old plaintext backup runs migration again.

## Verification and primary references

Automated tests use synthetic keys with isolated temporary databases and
in-memory or temporary file stores. Fresh-process tests reopen provider, MCP and
Discord credentials for default and named bots without an OS credential service.
File tests cover key loss/restoration, restart, permissions, symlinks, hard links,
malformed files and exclusive creation. The wider suite covers authenticated
identity binding/tampering, random nonces, restart, browser/activity redaction, per-connection model auth,
editing/removal, legacy IDs, historical WAL/freelist cleanup, locked/missing stores,
SQLite write rollback and cleanup failure after commit. No real local provider
credentials are read for testing. The disposable browser fixture also uses this
in-memory store; it is never a production fallback.

- [Bun Secrets API and platform prerequisites](https://bun.sh/docs/runtime/secrets)
- [Apple Keychain access control](https://developer.apple.com/documentation/security/access-control-lists)
- [Secret Service locking and sessions](https://specifications.freedesktop.org/secret-service/latest-single/)
- [Windows credential persistence](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)
- [Node crypto authenticated encryption API](https://nodejs.org/api/crypto.html#class-cipheriv)
- [SQLite secure_delete](https://sqlite.org/pragma.html#pragma_secure_delete),
  [journal_mode](https://sqlite.org/pragma.html#pragma_journal_mode) and
  [VACUUM](https://sqlite.org/lang_vacuum.html)
