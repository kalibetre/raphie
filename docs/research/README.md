# One chat, many things going on: what similar projects do

Research snapshot of November 26, 2026, on how persistent assistants keep one long-running chat usable and affordable, and how they track several pieces of work from it. Four reports, each citing primary sources:

| Report                                                | Covers                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Hermes Agent](hermes-agent.md)                       | Nous Research's agent: Desktop Bot Mode, the messaging gateway, compaction, todos, cron |
| [Grok-style bots](grok-style-bots.md)                 | xAI's Grok Bot and Automations; Codync, OpenBot, Utsuwa, AIRI                           |
| [Dots-style assistants](dots-style-assistants.md)     | OpenAI dots; CopilotKit OpenDots, Digger OpenDots, Suparagent and others                |
| [Long-running assistants](long-running-assistants.md) | OpenClaw, Letta, Khoj, LangGraph, Graphiti, Mem0                                        |

The reports were written by research agents from documentation and source code. Nothing was run, and the closed products (dots, Grok Bot) do not publish their compaction thresholds or caching policies.

## Spot checks

Four central claims were checked against the cited pages:

- **Hermes** compacts a session in place under the same session id, summarizes the middle turns with a structured template, keeps a token-budgeted recent tail, and keeps older turns searchable through `session_search`. Its documentation does not mention SQLite or FTS5; that detail comes from the report's reading of the source and was not checked.
- **OpenClaw** shares one session across all direct messages by default, with no automatic reset, and compaction manages its context.
- **OpenAI dots**: a dot keeps working between conversations, and delegated work can get "separate, visible threads". The page does not describe a single main chat where results and scheduled runs land; a dot is one entity across ChatGPT and Slack, whose visible conversations stay distinct.
- **Digger OpenDots**: one main conversation hands longer jobs to "topics", reusable worker sessions with notes the owner can edit, and their results come back to the main conversation.

## Where the projects agree

1. **One continuing chat is normal.** OpenClaw's direct messages, Hermes' Bot Chat and Codync's private chat all keep one conversation going, and compact it in place rather than starting new ones.
2. **Ongoing work lives outside the chat's context.** Every project that tracks several things at once keeps them as durable records with their own sessions: OpenDots topics, Codync work sessions, Hermes todos and Kanban cards, OpenClaw isolated jobs and subagents, Grok Bot's Tasks pane. Results, questions and approvals come back to the chat; the work's detail does not stay in it.
3. **A summary is not enough on its own.** Hermes, Letta and Suparagent each let the bot recover exact earlier messages after compaction (search over the transcript, or recall of evicted messages), because summaries lose names, numbers and wording.
4. **Memory is maintained with provenance.** Letta consolidates memory in the background; Graphiti records when facts became true or stale; Mem0 has explicit correction operations. All keep where a fact came from.

## What this means for Raphie

Raphie already matches point 1, and its compaction (a 64k working size on large windows, a verbatim recent tail, and notes with commitments, open threads, preferences and facts) is in line with the projects that publish theirs. None of the reports argues for changing the thresholds before measuring.

In order of value:

1. **Build work items** as [CONTEXT.md](../../CONTEXT.md) and [ADR 0001](../adr/0001-one-chat-per-bot-with-work-items.md) describe: a durable record per ongoing responsibility, with a stable id, status, what it waits on, its latest result, and its own background session. Give every chat turn a short list of open items and a tool to read one in full. All four reports rank this first or second.
2. **Add transcript recall**: a bounded search over the bot's chat that returns exact excerpts with message ids, so the bot can quote what a summary dropped. It respects rewinds, and is scoped to the bot.
3. **Measure before tuning compaction**: per owner turn, uncached and cached input, summary calls and their cost, and overflow retries, on warm and cold caches. Also record the summary hook's own spend, which Pi's usage probably does not count (read from Pi's source, not tested).
4. **Later**: background memory consolidation after compaction, with sources kept and corrections honoured.
