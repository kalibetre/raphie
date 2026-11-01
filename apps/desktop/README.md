# Raphie for macOS

This is an experimental native macOS client for an existing Raphie server.
It connects over HTTPS, opens device approval in the system browser, stores the
device token in macOS Keychain, and supports bot selection, recent conversations,
messages and tool-approval decisions. It polls for updates; streaming, older
history, attachments, settings, notifications, and distribution signing are not
implemented. Disconnecting from this Mac removes its local token; use the web
account settings to revoke the server-side device session.

To build a local ad-hoc-signed app bundle on macOS 13 or later:

```sh
sh apps/desktop/build-app.sh
open dist/desktop/Raphie.app
```

Enter the server's HTTPS origin, such as its Tailscale Serve address, and follow
the approval prompt. The server must have been configured with that exact origin.
Tailscale must be connected on both devices, and your tailnet rules must permit
the connection. This build is for local testing, not a notarized release. Draft
release archives for Apple Silicon are also ad-hoc-signed and are not notarized;
they are experimental and may be blocked by Gatekeeper. Do not treat them as a
production distribution.

Run the unit tests with `swift test --package-path apps/desktop`. The optional
integration test requires a disposable fixture with synthetic credentials and an
HTTPS endpoint; it is skipped unless `RAPHIE_TEST_ORIGIN` is set. Never point it
at a real installation: it creates a conversation and revokes a device.

To reproduce it on a test machine with Tailscale Serve, first check that port
8443 has no existing Serve configuration (`tailscale serve status`). Replace
the example hostname below with that machine's actual tailnet DNS name. Build
the web app with `bun run build`, then start the fixture:

```sh
RAPHIE_TEST_ORIGIN=https://machine.tailnet.ts.net:8443 bun apps/desktop/test-fixture.ts
```

In another terminal, start a foreground proxy, then in a third terminal run the
test:

```sh
tailscale serve --https=8443 http://127.0.0.1:14329
```

```sh
RAPHIE_TEST_ORIGIN=https://machine.tailnet.ts.net:8443 swift test --package-path apps/desktop --filter IntegrationTests
```

Stop the foreground proxy and fixture with Ctrl+C. The fixture uses temporary
data and fixed synthetic credentials; it never connects to the normal runtime.
