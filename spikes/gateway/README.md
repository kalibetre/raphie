# Pi Durable + Chat SDK gateway experiment

This spike tests the messaging boundary for Raphie: one persisted conversation shared by a desktop web interface and Discord. Send a note or up to four files, approve a precise file-copy operation from either interface, and download the result. The action is deterministic: there are no model, MCP, email, or calendar calls.

## Run locally

Use Node 24 or newer and npm. From this directory:

```sh
npm ci
npm run config:check
npm start
```

Open http://127.0.0.1:4315. The web flow works without Discord configuration. Data lives in the ignored `.data/` directory, including `gateway.sqlite` and a content-addressed file directory. Keep that whole directory to preserve the experiment across restarts. Run one service process against it.

The web interface binds only to loopback and trusts the local user. For a remote server, use an SSH tunnel to port 4315. Public hosting needs authentication and a separate deployment design.

## Enable Discord

Configuration names and defaults live in [.env.schema](.env.schema). Use your secret provider or enter values yourself in an ignored `.env.local`; never paste the bot token into chat. `npm start` injects configuration through Varlock, and `npm run config:check` validates it with sensitive values redacted.

Set all five values together:

- `DISCORD_BOT_TOKEN`: the bot token from your Discord application.
- `DISCORD_APPLICATION_ID`: the application ID.
- `DISCORD_PUBLIC_KEY`: the application's public key. SDK 4.43.0 requires it even for Gateway mode.
- `DISCORD_OWNER_ID`: your Discord user ID, the only authorized sender and approver.
- `DISCORD_CHANNEL_ID`: one channel ID used for both incoming messages and outbound results.

Startup looks up the channel in Discord and detects its server ID (or `@me` for a DM). `DISCORD_GUILD_ID` is an optional assertion; startup rejects it if it does not match. For this spike, use a plain channel or DM rather than a Discord thread; the encoded route is `discord:<guild or @me>:<channel>`. This lookup matters because outgoing REST posts only need a channel ID, while incoming event routes also include the server ID. Assuming `@me` for a server channel previously allowed outbound delivery but silently rejected incoming messages.

Enable **Message Content Intent** in the Discord Developer Portal. Install the bot in the target server with View Channel, Send Messages, Embed Links, Attach Files, and Read Message History permissions. For a DM, open the conversation with the bot first and use its channel ID.

The SDK's Gateway listener receives messages and button interactions over an outbound connection. No public webhook URL or tunnel is needed for Discord. Leave the application's Interactions Endpoint URL unset so interactions use the Gateway. The listener rotates every hour and reconnects after it ends; its underlying Discord client handles connection recovery. “Discord configured” in the web UI indicates configuration, not a verified live connection.

## What owns what

- **Pi Durable 1.3.0** owns persisted approval state, task checkpoints, decisions, and the outbound delivery queue in SQLite. Web and Discord both call the same acceptance/decision methods.
- **Chat SDK / Discord adapter 4.43.0** parses Discord messages, routes actions, renders buttons/cards, edits resolved cards, and uploads result files. Its in-memory state handles transient SDK coordination; it is not the source of truth for approvals or deduplication after restart.
- **Raphie** owns authorization, exact proposal contents, expiry, file storage, event deduplication, effect idempotency, and delivery uncertainty.

The released durable package lacks the newer `sleepUntil` API seen during earlier research. This implementation uses an invocation-bound document watch and expiry timer; pending tasks rebuild their wait on reopen. This is a correctness spike, not evidence that these waits scale to large fleets without overhead.

Files are limited to 8 MiB each. Discord downloads require HTTPS URLs on Discord's CDN, reject redirects, have a 15-second timeout, and enforce the size while streaming. Original filenames are sanitized metadata, never storage paths. Upload retries with identical names and bytes reuse a reference. The approval fingerprints include the text and exact file references; reusing an event ID with changed content is rejected.

Approvals expire after ten minutes. The first valid decision wins; later decisions return the persisted outcome. Rejection and expiry never run the effect. The effect writes deterministic result blobs, then commits completion. A process crash in that gap reuses the same blobs on recovery.

Outbound Discord deliveries are claimed durably before sending. A crash or send error marks an attempt `uncertain`; the web app shows it, and automatic retry stops for that attempt. This avoids blindly repeating a potentially successful send, but does not guarantee exactly-once delivery. There is no reconciliation or manual retry UI yet. Later delivery records may still proceed, including result delivery after an uncertain approval-card send.

## Verification recorded on 2026-10-19

```sh
npm run check
npm test
npm run config:check
```

All six tests passed under Node 22.23.1 and Node 26.8.2; Node 24+ remains the declared runtime requirement. No build step is needed: Node runs the TypeScript source directly.

The tests cover:

1. Binary file round-trip, unsafe filename handling, repeated-upload references.
2. Pending approval reopening, competing web/Discord decisions, unauthorized decisions, event replay, and interrupted outbound delivery.
3. Rejection and expiry without effects.
4. HTTP multipart upload, service reopening, duplicate decisions, binary download, missing files, and local origin/Host checks.
5. Real Chat SDK parsing and dispatch against a local Discord API fixture: incoming attachment storage, unauthorized users, restart and redelivery, approval buttons, resolved-card editing, multipart result upload, and uncertain sends.
6. A child process killed with SIGKILL after writing a result but before committing completion. Reopen produces one committed effect and no additional blob.

Browser verification used the actual web UI: compose a note, send it, restart the service while approval is pending, approve, and compare the downloaded text. Keyboard focus returned to the composer; Tab reached the file input with a visible outline. Layout had no horizontal overflow at 320, 768, 1024, and 1440 px. The restart produced expected temporary connection errors; there were no application script errors. A full screen-reader/axe audit was not performed.

The Discord test uses the installed SDK, but **does not authenticate to Discord or open a live Gateway connection**. It feeds parsed events into SDK dispatch and captures real REST payloads through a local fixture. Attachment fetch is injected. SDK 4.43.0 ignores `apiUrl` for multipart uploads, so the test also intercepts that hard-coded Discord API path and blocks external requests. An initial fixture run exposed this behavior through a 401 response using a dummy fixture token; no real bot credential was involved.

## Live acceptance checklist

After configuring your bot:

1. Send a binary attachment in the allowed Discord channel and download it from the web UI. Compare its bytes.
2. Approve in the web UI; confirm the Discord card disables its buttons and the result arrives as an attachment.
3. Send another request from the web UI, restart the service, then approve using the Discord button. Confirm the web UI shows the result.
4. Click the resolved card again; confirm no second effect or result delivery appears.
5. Try another Discord user/channel and an oversized attachment. Confirm no approval is accepted.
6. Stop the process during outbound delivery and inspect any `uncertain` attempt before considering a retry.

## Interpretation and limits

The local evidence supports using Pi Durable for shared interaction state while borrowing Chat SDK's platform rendering and transport. It also confirms that the application still owns important gateway behavior.

This remains a single-owner, single-process experiment with bounded files but unbounded history and local disk growth. There is no retention, durable Discord ingress/replay, live connection-health UI, rich error response in Discord, multi-tenant authorization, streaming model output, or production deployment. Discord messages arriving while the service is down are not backfilled by Raphie. Invalid incoming Discord messages are rejected and logged generically, without echoing content or credentials. Email/calendar actions will need their own approval policy and idempotency or reconciliation; the filesystem proof does not establish exactly-once behavior for those services.

The next decisive check is the live acceptance flow above before adding a model or MCP integrations.
