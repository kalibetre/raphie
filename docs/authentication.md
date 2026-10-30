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
through Better Auth's reset flow and **signs out every browser**. It also
repairs a half-finished setup. Recovery needs local access to the data
directory; nothing about it is reachable over HTTP, and the running web host
cannot create an administrator or reset a password even if a route were exposed.

## What is protected

The gateway runs before the application in both the production host and the
Vite development server; there is no development or standalone bypass. Every
page, server function, `/api/*` runtime proxy request, download and event stream
is checked. Only these are public: `GET /login`, built `/assets/*`, `GET
/_raphie/health` (`ready` or `locked`), `GET /auth/status`, and sign-in/sign-out.

- Sessions last 30 days and refresh daily. The cookie is `HttpOnly`,
  `SameSite=Lax` and named per web port (`raphie_<port>.session_token`).
- The session is re-read from the database on every request, so revocation is
  immediate. Open event streams are re-checked every two seconds and closed when
  their session ends.
- Requests must use a configured loopback `Host`. State-changing requests must
  carry a matching `Origin`. Better Auth's sign-up, reset and other routes are
  not served.
- Sign-in is rate limited to 5 attempts per minute, other authentication calls
  to 60. Because Raphie has one administrator and does not trust forwarded
  address headers, the limit is **one shared bucket**: someone who can reach the
  port can lock sign-in for a minute at a time. Existing sessions are unaffected
  and `raphie auth recover` still works.
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
everyone must sign in again; a malformed or group/world-readable secret is
refused rather than replaced.

The runtime, web host, and admin CLI use the same data-directory resolver.
Source-mode commands load Varlock configuration for all three. Use
`raphie start --data-dir PATH` and `raphie auth setup --data-dir PATH` (or
`recover`) to select a directory explicitly. The web host prints its selected
path at startup. Installed Linux services retain the directory selected at install time.

## Limits

- Loopback HTTP only. Cookies are not `Secure`, and a reverse proxy or non-loopback
  origin is unsupported. Use an SSH tunnel for remote access.
- Port `4316` (the runtime) still trusts any local process, as before; sign-in
  protects the browser-facing web host, not the runtime.
- In development the Vite hot-reload WebSocket is not gated; it carries no
  application data.
- Device authorization, multiple users and passwordless sign-in are not
  implemented.
- For browser acceptance, create an administrator with `bun run raphie auth setup`
  first and sign in at the fixture URL; the fixture has no sign-in bypass.
