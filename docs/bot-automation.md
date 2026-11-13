# Bot MCP tools and scheduled jobs

Each bot has **MCP tools** and **Scheduled jobs** pages in Settings. Connections
and jobs belong only to that bot. MCP connections are owner configuration.
Agents can create, modify and delete schedules through tools without a separate approval.
Existing local owner API protection applies to all mutations.

## MCP tools

Connect a Streamable HTTP server using its URL and optional bearer token, or a
stdio server using a command, a JSON array of arguments and an optional JSON
object of environment values. Local commands run as the runtime's process account;
they are not sandboxed. Only PATH and explicitly supplied environment values are
passed to the command. Remote bearer tokens require HTTPS; loopback HTTP is allowed.
Legacy SSE transport is not supported.

For servers supporting MCP OAuth discovery and automatic client registration,
leave the bearer token empty. Add the server, choose **Authorize**, then sign in
and grant access in the new browser tab. Settings refreshes the connection status
automatically after consent. Access and refresh tokens are encrypted with that
bot's connection; reconnects refresh expired grants without another sign-in when
the server permits it. No grant is shared with another bot.

Consent expires after five minutes. **Cancel authorization**, Pause, Remove and
runtime shutdown retire the callback. After denial or expiry, choose Reconnect
for a fresh attempt. The callback validates state, PKCE and the returned issuer
when supplied. Remote OAuth connections require HTTPS; loopback HTTP is allowed.
The browser must be on the runtime's machine to reach its loopback
callback. Servers requiring a pre-registered client ID or custom authorization
parameters need additional configuration support; pasting a supported bearer
token remains available.

Pi's MCP client owns initialization, paginated discovery, cancellation and
transport shutdown. Pi's deferred tool search loads tool definitions as needed.
Discovering tools does not approve their execution: each model-proposed action
uses Raphie's durable exact-argument approval gate, including tools advertising
read-only hints. The conversation's command permission mode and command session
grants do not authorize MCP calls. This includes Executor: Raphie approves the
MCP call, while Executor manages approvals for actions within its own service.
Interrupted remote actions retain the existing uncertain-outcome protection
rather than being repeated automatically.

Use Pause, Enable/Reconnect and Remove to manage servers. Configuration changes
are blocked while the bot has pending turns or approvals. Replace a configuration
by removing it and adding its replacement. An unavailable server on startup does
not stop the bot; reconnect it from Settings. Connection status reflects the
client established at connection time, not continuous server health.

Transport configuration, including tokens, arguments and environment values, is
encrypted in each bot's `mcp.sqlite`, with an OS-held key and owner-only database
permissions. APIs return connection summaries, never saved credentials. Follow
the [credential-store prerequisites and recovery guidance](provider-credential-storage.md).
Legacy `MCP_TRANSPORT`, `MCP_URL`, `MCP_BEARER_TOKEN`, `MCP_COMMAND` and
`MCP_ARGS` configuration loaded by Varlock remains available to the default bot
only. Settings identifies it as environment configuration. **Import encrypted
copy** explicitly copies the current transport configuration into that bot’s
encrypted store and records the decision atomically. Subsequent environment edits
are ignored, including after the saved connection is removed. The source env
files are never edited. Before import, removing host configuration and restarting
disables the connection; pause/remove in Settings requires import first. Existing
saved connections are preserved, never replaced or merged. An unavailable server
stays visible as disconnected.

Legacy tool names and connection identity stay compatible across import so
pending approvals cannot acquire a different server. Legacy SSE is unsupported:
startup fails explicitly without modifying its configuration. Change the host
configuration to Streamable HTTP or stdio. Stdio receives PATH only, not inherited
host credentials; supply required environment values in a new encrypted connection.
No credential or transport argument is returned through the owner API.

## Home channel for scheduled updates

Each bot has one optional home destination. Send `/home` in a verified Telegram
private chat, explicitly addressed Telegram group, or authorized Discord conversation to select that conversation.
No chat ID is taken from message text and no model call is needed. Telegram
registers `/ask`, `/pair`, `/home`, `/help` and `/start` in its private-chat menu,
and `/ask`, `/home`, `/help` for groups. In a group use `/home@BotName`; only verified
owners can select it, and all group members can read the scheduled output.
Discord registers `/home` as a global native slash command on connect/restart,
for servers and bot DMs, using an individual command upsert that preserves other
application commands. Native Discord confirmations/refusals are private to the
invoking user. Discord continues to use the allowed-user list in Settings rather
than a `/pair` flow. Text `/home` remains supported for compatibility.

Discord installations need the `applications.commands` scope (included with the
standard bot installation). Reauthorize the app if commands are missing; allow
Discord’s command propagation and refresh the client. Registration failures fail
connection rather than silently claiming success; save the connection again after
fixing permissions/network access. See [Discord’s command documentation](https://docs.discord.com/developers/docs/interactions/slash-commands). Web chat does
not interpret `/home`; use Settings → Channels to select a known destination or
**Web only** (the default). Natural-language requests do not change routing;
the owner must use the command or Settings. A channel message registers its
conversation as a Settings candidate; `/home` also works before the first turn.

Every scheduled turn, wherever its job was created, freezes the selected home
at admission. Changing home affects future turns only. Replies are labelled
“Scheduled: <job name>” and use the normal persisted delivery worker, including
chunking, rate limits and uncertain-send recovery. No session is linked, no
transcript is copied, and replying at home continues that channel’s own session.
The original scheduled session remains available in the web workspace.

If home is absent, disabled, disconnected or its selecting account was revoked,
new scheduled turns stay web-only. Session history reports `scheduledDelivery`
as `web-only`, `home-unavailable` or `home` (a destination was captured, not proof
of delivery). There is no fallback to another channel and no automatic resend
of missed notifications when a connection returns. Already admitted turns keep
their destination; changing home or revoking an account does not cancel those
turns or their queued deliveries. Check pending work before sharing/reusing a chat.

Scheduled tool approvals and Telegram group-origin tool approvals are decided in
the web workspace. Home receives an
“Approval needed” notice without approval buttons; being the home destination
does not grant authority over a job created elsewhere. One home per bot is
supported; per-job overrides and natural-language routing tools remain planned.

## Scheduled jobs

A job sends a one-time or recurring prompt to its bot and keeps the results in one conversation.
Use **Create job** to choose a name, prompt, Once or Recurring, interval in whole minutes,
and the first-run date and time in the scheduling dialog. Times are
entered in the browser's local timezone; recurrence is a fixed elapsed interval,
not a cron expression or a daylight-saving-aware calendar rule. The runtime must
be running to execute a job. After downtime, overdue work runs once; it does not
replay every missed interval. The next interval starts after submission.

Pause stops future recurring submissions; Resume schedules an overdue job now.
Run now queues one additional submission without moving the recurring schedule
and also works on paused jobs. Remove stops future work and keeps the conversation.
Pause/remove do not cancel an already submitted turn or reverse tool actions.
Jobs wait while the bot has an active turn or pending approval. Run now rejects
an already-busy bot. Tool actions from scheduled prompts need the same owner
approval as interactive prompts.

Run history shows queued, running, completed, failed, and interrupted outcomes, with links
to their conversations where available. It loads 20 runs at a time as you scroll;
the latest page stays live while older pages remain loaded. Refresh returns to the latest page. Finished runs appear on the Notifications page
until opened or dismissed; acknowledgement persists across restarts. Active and unread
runs are retained, along with the newest 500 acknowledged runs per bot. Earlier runs
created before tracking was added have no completion history. Submission is attempted at most four times, with durable waits of 1, 2 and 4
seconds. Retries preserve the event ID and admission fingerprint across restart;
a one-time reminder remains enabled until submission succeeds or attempts are
exhausted. Exhaustion records a failed run with the safe reason `no_model` for a missing model connection or `unknown` otherwise, never
raw transport text. Recurring jobs then schedule their next interval; one-time
reminders stop and retain the failure in Notifications. Reply failures also use
the safe reason `unknown`.

A run starting more than 60 seconds after its scheduled time is marked Late in
run history and Notifications. Busy bots and pending approvals remain queued,
with Waiting for bot shown on the job card and an explanation in run history.
There is no expiry: both one-time and recurring work wait until the bot is free,
so reminders are not discarded and approvals are never bypassed. Pause or Remove
interrupts an unadmitted waiting run.
Configure the bot's model in Settings before running jobs.

Ask the agent, for example, "In two minutes, tell me the time and a funny saying."
The `schedule_create` tool saves the prompt, run time and optional repeat interval
directly, without an approval prompt or redundant confirmation. One-time reminders use
`everyMinutes: null`, stop after one submission and show Sent or Failed in Settings.
Reminders created in chat return to the originating conversation; jobs created in
Settings create their own. Replies appear in the app and at the configured home channel, without device push
notifications. Delays are relative to the tool request; if the bot is busy when
the reminder is due, delivery waits until it is free.

`schedule_list` lets the agent inspect its own bot's schedules. `schedule_update`
changes the name, prompt, next run, recurrence or enabled state; `schedule_delete`
removes future work while keeping the conversation. Neither asks for approval.
Only confirm an action after the tool reports success. External tool actions
performed by a scheduled prompt still use their normal approval gate.

For an edit such as "I changed my mind, make it about Pi Durable", the agent's
scheduling guidance directs it to update the existing reminder in place. A
topic-only update keeps its ID, due time, repeat interval and enabled state;
`delaySeconds` resets the timer only when a timing change is requested. The
scheduling extension describes the tools currently offered on each turn so old
assistant claims about missing tools do not define current capabilities. Tool
selection remains model-driven; deterministic tests verify storage behavior,
not whether a model will always choose the intended tool.
A conversation whose earlier replies claimed a tool was missing can keep
repeating that claim; start a new conversation after upgrading the runtime.

When a job is due, its saved instruction is submitted as a **scheduled** turn,
not an owner message. The model is told the job is due and to write the message
itself, so it delivers the reminder instead of answering a request. Chat shows a
"Scheduled · job name" marker in place of the owner bubble, with the saved
instruction in its tooltip, and a job created in Settings titles its new
conversation with the job name. Only the internal job runner can mark a turn as
scheduled; HTTP message input cannot.

The model cannot select another bot or destination conversation. Changes and
task-scoped replay receipts commit atomically, preventing duplicate jobs or
repeated edits during recovery. Replaced timers are retired and fenced from
submitting stale prompts. You can also remove or pause schedules from Settings. Scheduling tools are installed at startup;
after upgrading a running runtime, restart it before trying them in chat.

Pi Durable 1.4 sleeping tasks own timing and restart recovery. Job configuration
and checkpoints live in that bot's `gateway.sqlite`; stable event IDs deduplicate
replayed submissions. Sleeping jobs do not hold an active task invocation.
The UI allows up to 100 jobs and 16 MCP connections per bot through the API;
this is a configuration limit, not a benchmark of simultaneous execution capacity.

## HTTP interface and verification

Use `/api/mcp` and `/api/jobs` for the default bot, or
`/api/bots/<bot-id>/mcp` and `/api/bots/<bot-id>/jobs` for another bot.
GET returns `{ items }`; POST creates an item. POST to `/<id>` takes an `action`:
MCP supports `enable`, `disable`, `remove`; jobs add `run`.
Run history is available at `GET /runs`, unread updates at `GET /notifications`,
and `POST /runs/<id>/read` acknowledges an update. Both lists support a `before`
cursor and report the total number of matching runs. Creation fields are defined in `packages/contracts/src/bots/automation.ts`.

Tests cover encrypted storage, restart recovery, per-bot isolation, deferred tool
discovery and shared job conversations. Run `bun run validate` for all checks.
