# Raphie: persistent conversations

One local service, a desktop web interface, and Discord. Each Discord thread is a separate Pi Durable conversation. Open it in the web sidebar to read its history or continue talking; replies also go back to that Discord thread. Web-only conversations stay on the web.

The first assistant slice is text conversation with history. It has no calendar, email, reminders, structured tasks, cross-conversation memory, file reading, or external-action tools yet. Ordinary messages no longer trigger copy approvals.

## Start

Use Node 24+ and npm. From this directory:

```sh
npm ci
npm start
```

Open http://127.0.0.1:4315. The default model is `anthropic/claude-haiku-5.5` through OpenRouter. Configuration lives in [.env.schema](.env.schema); put your key in your secret provider or manually in ignored `.env.local` as `OPENROUTER_API_KEY`. Never paste keys into chat. `RAPHIE_MODEL` selects an OpenRouter model from the installed runtime catalog. Restart after configuration changes.

Without a key the UI shows setup instructions, and sending chat is disabled. The file-copy experiment remains available at http://127.0.0.1:4315/experiment.

The web server binds to loopback and trusts the local user. For access to a remote machine, use an SSH tunnel. Public hosting needs a separate authentication/deployment design. Run only one process against the data directory.

## Discord

Keep the existing bot setup. Set these five values together: `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_OWNER_ID`, and `DISCORD_CHANNEL_ID`. The application public key is required by this Chat SDK version even in Gateway mode. Startup looks up the configured channel to discover its server; optional `DISCORD_GUILD_ID` is checked against that result.

Enable **Message Content Intent**. Install the bot into your server with View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Create Public Threads, and Send Messages in Threads as appropriate for your channel. Leave the application's Interactions Endpoint URL unset: the SDK opens an outbound Gateway WebSocket, so no public endpoint or tunnel is needed for Discord.

- Mention Raphie in the configured server channel. Chat SDK creates a thread, and Raphie replies in it.
- Continue replying in that same thread to preserve context. Another top-level message can create another thread and conversation.
- Open the conversation in the web sidebar to continue it there. Web-originated replies in a Discord-linked conversation are delivered to the same thread.
- A configured DM channel is one conversation. Owner/channel authorization still applies.
- `/copy your note`, or `/copy` with attachments, invokes the original file approval experiment. This is a plain message prefix, not a registered slash command. Chat attachments currently return a message explaining this limitation.

The service must be running to receive Gateway events. Messages sent while it is down are not backfilled. This slice does not migrate earlier copy requests into model conversation history; they remain available at `/experiment`.

## Persistence and recovery

Keep the entire ignored `.data/` directory (or `DATA_DIRECTORY`). `gateway.sqlite` contains both the original approval experiment and the new chat state. Files remain in its `files/` directory.

Each new conversation is created atomically with its index entry and first durable reply task. Pi Durable owns the model transcript and generation tasks. Raphie's session document stores navigation metadata, user turns, final text replies, and Discord delivery claims. The two are committed in the same database.

Incoming event IDs are deduplicated, including after restart. Reusing an event ID with different text or destination is rejected. Each durable reply task submits to Pi using its own stable request ID, so recovery after submission finds the same work. Pending model work resumes on reopen. Concurrent follow-ups use Pi's one-at-a-time queue policy.

History is isolated by conversation. The system prompt explicitly describes the absent tools and memory so Raphie does not promise to perform actions it cannot take. The current model is applied when a new message is admitted; existing history is retained.

Discord answers are split into chunks below the platform's content limit. Each chunk is claimed before network delivery; a send error or a restart during sending marks it `uncertain`. The web app shows the saved answer and a delivery warning. There is no automatic resend or reconciliation UI. Provider calls interrupted during recovery may run again and incur another charge; this is not an exactly-once network guarantee.

The UI displays final model replies, not streamed tokens. Pending turns show “Thinking…”, and failed generation settles to a visible error. Retrying a failed generation requires sending a new message; repeating the same event ID returns the existing turn. Draft text is retained when switching conversations in the current browser page, but is not persisted across page reloads.

## Verify

```sh
npm run check
npm test
```

The suite uses the real Pi Durable generation machinery with an injected deterministic provider and local Discord REST fixtures. It covers history across restart, conversation isolation, concurrent follow-ups, event replay/conflicts, pending generation recovery, visible provider failure, missing configuration, and Discord thread replies. It also retains the original binary file, approval race/expiry, HTTP origin, and SIGKILL tests. No real credentials or model spend are needed for the suite.

On 2026-10-20, all ten tests passed on Node 26.8.2. A live browser test used the configured OpenRouter Haiku 5.5 model to store a test codename in a conversation, restart the service, and correctly recall it. A separate conversation correctly had no knowledge of that codename. Draft switching and responsive layouts were checked at 320, 768, 1024, and 1440 px with no horizontal overflow or application script errors. A full screen-reader audit was not performed.

The user also exercised a live Discord-linked conversation: its persisted state showed one Discord turn and one web turn in the same conversation, both completed with model replies. Both outbound deliveries were recorded as sent to that same Discord thread. The previous gateway-only experiment and its earlier verification notes are archived in [GATEWAY-EXPERIMENT.md](GATEWAY-EXPERIMENT.md).

To try recovery yourself: say a fact, wait for the answer, stop/start the service, open the saved conversation, then ask about that fact. Start a different conversation and confirm it has separate context. In Discord, continue inside the thread rather than posting a new top-level message.

This remains a single-owner local application. History, prompt size, and storage are not yet bounded by retention or pagination. Conversation history is useful context, not a substitute for structured commitments or scheduled reminders; those are the next feature slices.

## Generic MCP connection check

The reusable client in `src/mcp.ts` uses the official `@modelcontextprotocol/client` SDK. It supports Streamable HTTP (`MCP_TRANSPORT=http`), legacy HTTP+SSE (`sse`), and local child-process servers (`stdio`). It performs the MCP handshake, discovers all tool pages, and exposes the same call interface for each transport. This is a connection probe; MCP tools are not yet registered with the chat model.

For a remote server, manually add any required bearer token as `MCP_BEARER_TOKEN` in ignored `.env.local`, then run:

```sh
npm run mcp:check -- https://your-server.example/mcp
```

Alternatively set `MCP_URL`. The probe prints server metadata and tool names, never the token. Remote bearer authentication requires HTTPS. The endpoint may also be accessible only through a private network such as Tailscale. There is no tunnel or inbound listener involved in this client connection.

To explicitly call a benign tool after discovery, set `MCP_PROBE_TOOL` and JSON-object `MCP_PROBE_ARGS`. For Executor, `skills` with `{"name":"execute"}` reads its public usage guide. The probe reports success/error and content types without dumping the result. It does not automatically select or execute any integration tools. Unknown tool names are rejected locally.

For stdio, set `MCP_TRANSPORT=stdio`, `MCP_COMMAND`, and optional JSON-array `MCP_ARGS`, then run `npm run mcp:check`. The programmatic connector also accepts an explicit child-process environment. The CLI does not forward the entire application environment into a child server; configure any server-specific credentials separately. Server stderr is suppressed so it cannot accidentally print credentials into the probe output.

Connection and discovery requests time out after 15 seconds; an explicit tool probe after 30 seconds. The client closes connections and terminates HTTP sessions where applicable. Failures are reported generically because transport/server errors can include credentials or private URLs.

Local tests cover all three transports, paginated discovery, bearer-token rejection/acceptance, and a harmless echo round trip. Thirteen total tests pass on Node 26.8.2. Bearer authentication is supported; interactive OAuth login, MCP resources/prompts, sampling, elicitation, artifact rendering, and agent-driven tool execution are not part of this check. Supporting these standard transports is not a claim that every MCP server or optional capability has been tested.
