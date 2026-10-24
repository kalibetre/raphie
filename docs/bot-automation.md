# Bot MCP tools and scheduled jobs

Each bot has **MCP tools** and **Scheduled jobs** pages in Settings. Connections
and jobs belong only to that bot. MCP connections are owner configuration.
Agents can propose schedules through tools, subject to explicit owner approval.
Existing local owner API protection applies to all mutations.

## MCP tools

Connect a Streamable HTTP server using its URL and optional bearer token, or a
stdio server using a command, a JSON array of arguments and an optional JSON
object of environment values. Local commands run as the runtime's process account;
they are not sandboxed. Only PATH and explicitly supplied environment values are
passed to the command. Remote bearer tokens require HTTPS; loopback HTTP is allowed.
Legacy SSE transport is not supported.

Pi's MCP client owns initialization, paginated discovery, cancellation and
transport shutdown. Pi's deferred tool search loads tool definitions as needed.
Discovering tools does not approve their execution: each model-proposed action
uses Raphie's durable exact-argument approval gate, including tools advertising
read-only hints. Interrupted remote actions retain the existing uncertain-outcome
protection rather than being repeated automatically.

Use Pause, Enable/Reconnect and Remove to manage servers. Configuration changes
are blocked while the bot has pending turns or approvals. Replace a configuration
by removing it and adding its replacement. An unavailable server on startup does
not stop the bot; reconnect it from Settings. Connection status reflects the
client established at connection time, not continuous server health.

Transport configuration, including tokens, arguments and environment values, is
encrypted in each bot's `mcp.sqlite`, with an OS-held key and owner-only database
permissions. APIs return connection summaries, never saved credentials. Follow
the [credential-store prerequisites and recovery guidance](provider-credential-storage.md).
No environment-configured MCP bootstrap server is loaded.

## Scheduled jobs

A job sends a one-time or recurring prompt to its bot and keeps the results in one conversation.
Choose a name, prompt, Once or Recurring, interval in whole minutes and first-run time. Times are
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

The last-run status reports prompt admission, not successful model completion.
Open the conversation to inspect the answer or failure. A failed admission is
recorded without raw transport error details, and the next interval still runs.
Configure the bot's model in Settings before running jobs.

Ask the agent, for example, "In two minutes, tell me the time and a funny saying."
The `schedule_create` tool proposes the exact prompt, run time and optional repeat
interval for approval. Nothing is saved until approved. One-time reminders use
`everyMinutes: null`, stop after one submission and show Sent or Failed in Settings.
Reminders created in chat return to the originating conversation; jobs created in
Settings create their own. Replies appear in the app, without device push
notifications. Delays are relative to the tool request; if approval arrives after
the requested time, the reminder runs when approved and the bot is free.

`schedule_list` lets the agent inspect its own bot's schedules. The model cannot
select another bot or destination conversation. Creation, approval completion and
the scheduler task commit atomically, preventing duplicate jobs during recovery.
Remove or pause schedules from Settings. Scheduling tools are installed at startup;
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
Creation fields are defined in `packages/contracts/src/bots/automation.ts`.

Tests cover encrypted storage, restart recovery, per-bot isolation, deferred tool
discovery and shared job conversations. Run `bun run validate` for all checks.
