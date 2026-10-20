# Raphie: persistent conversations

One local service, a desktop web interface, and Discord. Each Discord thread is a separate Pi Durable conversation. Open it in the web sidebar to read its history or continue talking; replies also go back to that Discord thread. Web-only conversations stay on the web.

Raphie supports text conversation with history and can use connected integrations through MCP tools. It has no built-in reminders, structured tasks, cross-conversation memory, or file-reading tool. Ordinary messages do not trigger copy approvals; MCP execution requests have their own approval flow.

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

The reusable client in `src/mcp.ts` uses the official `@modelcontextprotocol/client` SDK. It supports Streamable HTTP (`MCP_TRANSPORT=http`), legacy HTTP+SSE (`sse`), and local child-process servers (`stdio`). It performs the MCP handshake, discovers all tool pages, and exposes the same call interface for each transport. The standalone probe is independent from model conversations; configured MCP tools are also registered with the chat model at service startup.

For a remote server, manually add any required bearer token as `MCP_BEARER_TOKEN` in ignored `.env.local`, then run:

```sh
npm run mcp:check -- https://your-server.example/mcp
```

Alternatively set `MCP_URL`. The probe prints server metadata and tool names, never the token. Remote bearer authentication requires HTTPS. The endpoint may also be accessible only through a private network such as Tailscale. There is no tunnel or inbound listener involved in this client connection.

To explicitly call a benign tool after discovery, set `MCP_PROBE_TOOL` and JSON-object `MCP_PROBE_ARGS`. For Executor, `skills` with `{"name":"execute"}` reads its public usage guide. The probe reports success/error and content types without dumping the result. It does not automatically select or execute any integration tools. Unknown tool names are rejected locally.

For stdio, set `MCP_TRANSPORT=stdio`, `MCP_COMMAND`, and optional JSON-array `MCP_ARGS`, then run `npm run mcp:check`. The programmatic connector also accepts an explicit child-process environment. The CLI does not forward the entire application environment into a child server; configure any server-specific credentials separately. Server stderr is suppressed so it cannot accidentally print credentials into the probe output.

Connection and discovery requests time out after 15 seconds; an explicit tool probe after 30 seconds. The client closes connections and terminates HTTP sessions where applicable. Failures are reported generically because transport/server errors can include credentials or private URLs.

Local tests cover all three transports, paginated discovery, bearer-token rejection/acceptance, and a harmless echo round trip. Thirteen total tests pass on Node 26.8.2. Bearer authentication is supported; interactive OAuth login, MCP resources/prompts, sampling, elicitation, artifact rendering, and agent-driven tool execution are not part of this check. Supporting these standard transports is not a claim that every MCP server or optional capability has been tested.

Live Executor verification succeeded on 2026-10-20 over HTTPS Streamable HTTP using the locally configured bearer token. The server identified itself as `executor` version `1.0.0`, advertised seven tools (`execute`, `skills`, `resume`, and four artifact tools), and successfully answered `skills({"name":"execute"})` with text content and no tool error. The probe did not read or modify Gmail, Calendar, Jira, or other integration data. The token and tool-result body were not printed.

## Model tools and approvals

Startup connects to `MCP_URL` (the personal Executor endpoint is the schema default), or `MCP_COMMAND` for stdio. Keep `MCP_BEARER_TOKEN` in private configuration. Set `MCP_URL=""` in local configuration to disable the remote connection. Connection failure leaves chat available without external tools and displays a connection-error status; fix configuration and restart to reconnect. Tool discovery occurs at startup and is not refreshed dynamically.

The MCP catalog becomes Pi tools named `mcp_<server>_<tool>`, for example `mcp_executor_execute`. The bearer token stays inside the transport and is not included in model context, proposal previews, or tool results. MCP argument schemas are validated by Pi before a tool runs. Results are rendered as bounded text (30,000 characters); resource links are described, while non-text media is identified with a placeholder. Embedded MCP apps and artifacts are not rendered interactively in this web UI.

For the configured Executor, only the known `skills` documentation tool bypasses approval. Every other tool, including `execute`, `resume`, and artifact tools, requires a fresh owner decision. For a different MCP server, all tools require approval by default. Server-provided `readOnlyHint` annotations do not bypass this policy: an arbitrary code runner can hide writes inside a seemingly read-only request.

The proposal records the exact tool name, arguments, conversation, execution task, and a fingerprint bound to the connection configuration (including its credential). The web app shows the full arguments and provides a JSON download. Discord posts in the originating thread and attaches that same full JSON; buttons approve once or decline. Decisions are checked against the owner and, for Discord, the exact destination thread. No chat text can substitute for the approval button/API decision. Proposals expire after ten minutes; the first valid decision wins.

Approval is **per MCP call/code block**, not per integration request inside the code. An approved Executor snippet can make several Gmail, Calendar, or Jira calls. Review the entire snippet before approving. This release deliberately asks approval even for read-only `execute` snippets; finer policy would require a trustworthy enforcement boundary inside Executor.

Pending approvals survive service restart. The wrapper durably claims an approved call before sending it, and stores its normalized result before returning it to Pi. A network error or restart during a claimed call changes its execution to `uncertain`; recovery never sends that call again automatically. A stored result is reused if Pi's own tool receipt was not yet committed. A changed connection/credential or changed arguments fail the fingerprint check and require a new request rather than using an old approval. There is no reconciliation or retry UI for uncertain actions. This avoids blind repeats but does not provide exactly-once execution at external services.

Tool approval cards in Discord use durable delivery claims too. A delivery error is marked uncertain and shown in the web app; the proposal can still be reviewed and decided from the web. Resolved Discord cards disable their buttons. Local owner trust for the web interface remains unchanged: this is a loopback-only, single-owner service.

The 19-test suite covers actual model tool calls through Pi's generation loop, exact-argument preservation, pending approval reopening, competing/unauthorized/wrong-thread decisions, rejection, expiry, uncertain execution recovery, full Discord JSON attachments and card updates, and web download/origin checks. Documentation calls run directly under an explicit allowlist; even a fixture tool with a read-only hint still waits for approval.

Live model verification on 2026-10-20: Haiku called `mcp_executor_skills`, then proposed `mcp_executor_execute` with only a constant-return expression. The proposal stayed pending across a real service restart. After approval through the browser, Executor returned the expected marker and the model reported it. A second constant-return proposal was used to verify the decline path. No integration data was accessed or modified by these smoke tests.

The user also verified the live Discord path by requesting `discord-mcp-check`, reviewing the attached JSON, approving once, and receiving the result. Persisted state confirmed an approved, completed Executor call and completed conversation turn. Tool approval layouts were checked at 320, 768, 1024, and 1440 px without horizontal overflow. Type checking and all 19 tests passed on Node 26.8.2.
