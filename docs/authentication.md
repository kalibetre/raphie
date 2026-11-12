# Administrator authentication

Raphie's web host requires sign-in. There is one administrator, created on the
machine that runs Raphie. [Better Auth](https://better-auth.com) owns the
password hashing, sessions and password reset; Raphie adds no password code of
its own.

## Set up and recover

Until an administrator exists the web host is **locked**: `/login` explains how
to create one and everything else is refused (`503` for API requests, a
redirect to `/login` for page loads). Start Raphie, then on the same machine:

```sh
bun run raphie auth setup     # source checkout
sudo raphie auth setup        # installed (runs as the service user)
```

The command prompts for an email, then a password (12+ characters) and
confirmation. Nothing is accepted as an argument or environment variable, and
the password is neither echoed nor logged. A second `setup` is refused; the
database also enforces a single user, so racing commands create one account.

To reset a forgotten password run `raphie auth recover`. It changes the password
through Better Auth's reset flow and **signs out every browser and device**. It also
repairs a half-finished setup. Recovery needs local access to the data
directory; nothing about it is reachable over HTTP, and the running web host
cannot create an administrator or reset a password even if a route were exposed.

## What is protected

The gateway runs before the application in both the production host and the
Vite development server; there is no development or standalone bypass. Every
page, server function, `/api/*` runtime proxy request, download and event stream
is checked. Public endpoints include `GET /login`, built `/assets/*`, `GET
/_raphie/health` (`ready` or `locked`), `GET /auth/status`, sign-in/sign-out,
and the native device-code request and polling endpoints once an administrator
exists.

- Sessions last 30 days and refresh daily. The cookie is `HttpOnly`,
  `SameSite=Lax` and named per web port (`raphie_<port>.session_token`).
- The session is re-read from the database on every request, so revocation is
  immediate. Open event streams are re-checked every two seconds and closed when
  their session ends.
- Requests must use the configured `Host`. Browser state changes require
  a matching `Origin`; native API requests use a bearer session without browser
  cookies or an Origin header. Better Auth's sign-up, reset and unrelated routes
  are not served.
- Password sign-in limits each email/password pair to five attempts per minute.
  Keys are HMACs using the private authentication secret, never plaintext passwords
  or unsalted password digests. Successful sign-in clears its allowance. Wrong
  guesses cannot exhaust a valid credential's allowance, including after restart.
  The table holds at most 4,096 active keys; eviction permits retries.
  Other authentication calls retain a shared 60/minute limit, except passkey
  sign-in ceremonies, which have no shared lockout.
- This is duplicate-guess throttling, **not protection against distributed or
  varied-password guessing or resource exhaustion**. Restrict remote reachability
  with tailnet ACLs. Raphie ignores all forwarded client-address headers; there is
  no configurable client-IP proxy trust in this release. The TLS proxy must
  preserve the configured Host and prevent direct remote access to the listener.
  Existing sessions and local recovery do not depend on sign-in allowances.
- If the authentication store cannot be opened the host does not start; if a
  check fails at runtime the request is refused (`503`), never admitted.

## Storage and backup

`auth.sqlite` and `auth.secret` live in the data directory (`DATA_DIRECTORY`, or
`.data/` of the main checkout), mode `0600`, so the existing data backups and
restores include them. Both are sensitive: a backup contains the password hash,
live session tokens and the key that signs session cookies. Protect backups like
the data they contain.

Restoring a backup restores its administrator, password and sessions as of the
backup; run `raphie auth recover` afterwards if any of that is in doubt. The
schema migrates automatically at every start, so upgrades and restarts keep the
administrator and sessions. If `auth.secret` is lost Raphie creates a new one and
everyone must sign in again; active device sessions and outstanding device codes
are also invalidated. Password recovery invalidates outstanding device codes as
well as active sessions. A malformed or group/world-readable secret is refused
rather than replaced.

The runtime, web host, and admin CLI use the same data-directory resolver.
Source-mode commands load Varlock configuration for all three. Use
`raphie start --data-dir PATH` and `raphie auth setup --data-dir PATH` (or
`recover`) to select a directory explicitly. The web host prints its selected
path at startup. Installed Linux services retain the directory selected at install time.

## Connect a native device

A first-party client requests a short-lived device code, then shows a user code
and an approval link. Sign in in a browser, review the code on the approval page,
and explicitly approve or deny it. The link must include the code; opening
`/device` without one asks you to start from the device. Compare the code with the one on the device
in your possession. Never approve a code someone sent unexpectedly. A client ID
or device name is a claim, not proof of identity; an approved device receives
full workspace access.

The device code expires after 10 minutes and polling has a minimum interval of
5 seconds. A successful client receives its own 30-day bearer session, separate
from the browser. Settings → Account lists connected devices without exposing
their tokens and allows each to be disconnected. Revocation takes effect on the
next request and closes open event streams. Device tokens are credentials: a
real native client must store them in the operating system's credential store,
not in logs or plaintext files.

For a local synthetic test, start Raphie and run `bun scripts/device-auth-smoke.ts
http://127.0.0.1:4320`. Open the printed URL, compare the code and approve or
deny it. The test client only checks runtime access and does not save or print
the bearer token. Disconnect the test client in Account settings afterwards.
The web host listens on loopback. Remote access requires an SSH tunnel or a
configured HTTPS proxy; see [standalone builds](standalone-build.md#tailnet-access).

## Limits

- The web listener remains loopback-only. Remote access requires an explicitly
  configured HTTPS origin and a trusted TLS-terminating proxy. HTTPS origins use
  `Secure` cookies; loopback HTTP cookies are not `Secure`.
- Port `4316` (the runtime) still trusts any local process, as before; sign-in
  protects the browser-facing web host, not the runtime.
- In development the Vite hot-reload WebSocket is not gated; it carries no
  application data.
- Multiple users are not implemented.
- For browser acceptance, create an administrator with `bun run raphie auth setup`
  first and sign in at the fixture URL; the fixture has no sign-in bypass.

Use the account icon beside the sidebar connection status to open **Manage
account** or **Sign out**. Manage account opens Settings → Account; sign-out
ends only the current browser session.

## Passkeys

Settings → Account registers, lists and removes administrator passkeys using
Better Auth's pinned passkey plugin and its WebAuthn verification. Registration
requires a fresh signed-in browser session; sign in again if it has aged out.
Password sign-in remains available. Local `raphie auth recover` resets the
password, removes all passkeys and clears sign-in allowances as well as revoking
sessions. This lets the owner recover from a compromised authenticator.

Each configured origin has its own Better Auth instance, expected WebAuthn
origin and RP ID (the hostname, without port). Browser sessions remain separate.
Use `http://localhost:PORT` for local passkeys or a configured HTTPS DNS origin;
numeric loopback addresses are not portable WebAuthn RP IDs. Register separately
on unrelated hostnames, including Tailscale and custom domains. Credentials for
one hostname cannot sign in to another. Ports share the RP ID but ceremonies
still verify the exact origin. Only explicitly routed passkey endpoints are
exposed; native bearer sessions cannot register or manage passkeys.
