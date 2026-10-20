# Raphie

A personal assistant with durable conversations, explicit tool approvals, and an inspectable activity history.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4320**. The runtime listens on **127.0.0.1:4316**. Both bind to loopback.

For a production bundle, run `npm run build`, then `npm start`. This starts the built TanStack Start server and the independent agent runtime. Ctrl+C stops both. Use an external process supervisor for automatic restart; this slice does not install one.

Configuration is loaded through Varlock. The root `.env.schema` imports the existing private configuration under `research/spikes/gateway/`, without copying its values. Use `npm exec varlock -- load --agent` to inspect masked configuration. New installations can provide the keys named in that schema through their environment or a private `.env.local` file. A model API key enables chat; MCP is optional.

The product writes to root `.data/`; the archived experiment and its data are unchanged. Discord is disabled by default while the experiment's listener may still be running. Stop that listener before setting `RAPHIE_DISCORD_ENABLED=true` in your private configuration and restarting the product. The configured Discord owner and thread restrictions still apply.

## Architecture

- `apps/web`: TanStack Start and Router, React, TanStack Query, shadcn components, and AI Elements composition patterns.
- `packages/runtime`: an independent Node host; Effect scopes own MCP, Pi, HTTP, and Discord lifetimes. Pi Durable and SQLite own persistent execution and approval state.
- The browser gets an initial state snapshot and subscribes to SSE updates. Reconnect replaces the snapshot. Closing a tab only detaches its viewer; it never cancels work or repeats an action.
- TanStack AI's client renders a projection of the durable transcript. It does not own a second model loop, conversation database, or approval store. Our admission endpoint retains stable event IDs for retrying an ambiguous message submission.
- Vite proxies `/api` during development. Start server routes proxy the same API in the production build. API origin and host checks restrict access to the local workspace.

## First slice

Conversations support streamed text, Markdown, saved drafts, history after refresh, and pending/error states. MCP requests show the exact arguments before approval. Web and Discord decisions update the same persisted record. Pending approvals recover with their original deadline; an interrupted external action is marked uncertain and is not automatically repeated.

The activity inspector and Diagnostics page record precise UTC timestamps, local display times, run and runtime-attempt IDs, tool operation IDs, model usage, approval decisions, results, and recovery. Events expand to show payloads and export to JSON. Known credential values and sensitive field names are redacted before journal persistence.

This first journal keeps the latest **5,000 events**, truncates individual diagnostic payloads at **24,000 characters**, and does not persist individual text deltas. Timestamps describe when the host observed an event; “Model response started” is the first observed response, not the start of the provider's network request. Executor's nested calls and private model reasoning are not available here. Operation waterfalls and a backend plugin lifecycle are later work.

## UI plugins

`apps/web/src/plugins/index.tsx` defines host API version 1 and the `composer.footer` slot. Plugins receive `{ draft, model }` and render with shared UI components. The included token counter is an intentionally rough character-based estimate; actual provider usage is separate in Diagnostics.

Plugins are trusted local React modules loaded at build time. Each contribution has a render failure boundary. The Plugins screen saves enable/disable preferences in this browser. This is not an isolation boundary or a third-party plugin marketplace.

## Verify

```sh
npm run check
npm test
npm run build
```

Tests cover durable chat, interrupted generation, approvals after restart, concurrent decisions, cross-channel decisions, uncertain execution, file integrity, MCP transports, redaction, viewer disconnection, first-chunk streaming, and TanStack AI transcript replacement.

For browser acceptance without an API key or external actions, start `node packages/runtime/test/browser-fixture.ts` and `npm run dev:web` separately. The fixture occupies port 4316, uses a temporary database, streams a deterministic response, and proposes a fake calendar tool when asked to use a tool. Stop the real runtime first. Fixture state is removed when stopped normally.
