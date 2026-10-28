# Device pairing

This document describes the pairing-only server implementation and remaining
design work. Do not expose an installation publicly on the strength of this
experimental implementation alone.

## Goals and trust boundary

One owner controls a Raphie installation. A browser or native app is a client
of one installation and must be individually revocable. A person with local
administrator access to the host can bootstrap or recover owner access.
The service must never treat network location, a client-supplied device name,
or an app identifier as proof of ownership. A pairing code is a bearer secret:
anyone who obtains it can attempt to redeem it until it is used or expires.

## Bootstrap and enrollment

- `raphie pair` requires host administrator authorization. It creates a
  high-entropy, one-time enrollment secret with a short expiry and displays a
  QR and copyable setup payload containing the configured external HTTPS
  origin and the secret. Only a hash is stored server-side.
- A paired owner can create an enrollment secret in Settings → Devices. The
  screen must make clear that the QR grants access and allow cancellation.
- The client shows the target origin and asks the owner to confirm before
  redeeming. The server atomically consumes the secret and creates one device
  record and credential. Expired, reused, cancelled and concurrent redemption
  attempts fail. Credentials and setup payloads are never logged.
- Browser redemption returns a host-only Secure, HttpOnly, SameSite cookie.
  The pairing secret should be carried in a URL fragment or pasted, removed
  from the address bar before exchange, and never sent in a request URL.
  The pairing page must use a restrictive CSP, no third-party content,
  `Cache-Control: no-store`, and `Referrer-Policy: no-referrer`.
- Native clients redeem through HTTPS and store their device credential using
  platform-protected storage. Their bearer-authenticated API requests must
  not rely on the browser's cookies or weaken its origin/CSRF checks. Native
  clients need an explicit API contract and compatibility policy.

The QR secret itself does not prove the identity of the recipient: another
party who sees it can race the owner. A proof-of-possession challenge or a
pending-device approval with a matching confirmation code should be assessed
before implementing enrollment for public ingress. Do not claim that a pasted
code or QR alone is phishing-resistant. Validate the exact protocol with a
security review and threat-focused tests before public deployment.

## Device lifecycle and recovery

Store a device ID, a user-editable label, creation and last-use timestamps,
credential hash and revocation status. The label and timestamps are hints,
not authentication factors. Allow an owner to list and revoke one device,
and provide host-side list and revoke commands for recovery. Revocation must
close existing event streams and prevent reconnects. Define renewal, expiry,
credential rotation, concurrent use and database restore semantics before a
public release. A paired browser receives a persistent 90-day cookie and the
server independently expires its credential after 90 days. After expiry, an
administrator can run `sudo raphie pair` again. Remote gateway credentials are
currently held in the local web server's memory and must be paired again after
that server restarts; a mobile client does not exist yet.

## Deployment and migration

Public access requires a verified HTTPS endpoint and a proxy that forwards
the correct host and origin; Raphie's runtime remains loopback-only. A local
SSH tunnel can use loopback HTTP. Protect the enrollment and authenticated
surfaces with bounded request sizes and rate limits, and test streaming and
reconnects through the proxy. Public URLs must come from trusted installation
configuration, not untrusted forwarding headers.

Existing password-based browser sessions no longer authenticate after updating.
An administrator must run `sudo raphie pair` to regain access; the old account
database is left untouched. Backup and restore must account for the pairing store,
revocation state and the separate credential encryption key. A backup copied
to a different host must be tested before portable recovery is promised.

## Verification gates

Test first enrollment, replay and simultaneous redemption, expiration,
cancellation, bad origins, malformed inputs, rate limits, process restart,
device removal, idle and active event-stream revocation, app reconnection,
HTTPS proxy behavior, upgrade from an older installation and lost-device recovery.
Use a synthetic native-client harness before a mobile app exists. Review the
protocol and public ingress independently before enabling it for deployment.

The implementation includes one-time browser and native enrollment,
device-specific revocation, a browser confirmation page, a QR/link in the
terminal and Devices settings, and a host-side list/revoke command. Automated
checks cover replay, concurrent redemption, origin and size checks, rate
limits, revocation of an idle stream, and synthetic browser pairing. It does
not yet provide an independent device-approval step, durable mobile client,
automatic HTTPS proxy deployment, portable recovery,
or the required public-ingress security review. A loopback-only synthetic test
through Caddy with a locally trusted test certificate verified browser pairing,
secure cookies, API requests, and live-stream revocation; it did not exercise
public certificate issuance or automated VPS setup.

Device credentials do not currently rotate automatically. Existing prototype
devices expire 90 days after creation; expired or revoked devices must pair
again. Public-ingress review and portable recovery remain release gates.
