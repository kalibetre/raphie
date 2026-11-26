# Work items: design

Status: proposed, November 26, 2026. Decisions: [ADR 0001](../adr/0001-one-chat-per-bot-with-work-items.md), [ADR 0002](../adr/0002-work-items-own-their-runs.md). Background: [research](../research/README.md). Terms follow [CONTEXT.md](../../CONTEXT.md).

## Goal

A bot has one chat, but several things going on: a request it is still chasing, a job that runs every morning, a task another bot handed it. A **work item** is the bot's record of one of them. It lets the bot answer "what's going on?" from a durable list instead of from a summary, keep each piece of work's context apart, and bring results back to the chat when they are ready.

## The record

One Pi document per bot, `raphie.work-items`, in the bot's root conversation (like scheduled jobs).

| Field              | Meaning                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `id`               | Short and stable, such as `w-12`, so the bot and the owner can name it                             |
| `title`            | A few words, set by whoever opens it; the owner can rename it                                      |
| `status`           | `active`, `waiting`, `done` or `dropped`                                                           |
| `waitingOn`        | While waiting: the owner, another bot, a time, or something outside, in a few words                |
| `origin`           | `request` (from the chat), `job`, `handoff-sent` or `handoff-received`, with the job or handoff id |
| `source`           | The chat message that started it, when there is one, so results can quote it                       |
| `notes`            | The bot's short running notes, replaced as it goes; the owner can edit them                        |
| `result`           | The latest result: text, when, and the chat message that carried it                                |
| `sessionId`        | Its background session, once it has one; kept while the item is open                               |
| `nextAt`           | When it next wakes on its own: a job's next run, or a follow-up the bot set                        |
| `opened`, `closed` | When, and by whom (the bot, the owner, or the runtime)                                             |

Statuses stay few on purpose. `active` means the bot or its background session is working on it; `waiting` means it is blocked on `waitingOn`; `done` and `dropped` are closed. Closed items are kept and listed apart.

## Who changes it

- **The bot**, with tools: `work_open` (title, notes, optionally the message it comes from), `work_update` (status, waiting on, notes, result), `work_close` (done or dropped, with a result), `work_read` (one item in full, open or closed) and `work_list` (closed ones too, with a search). Opening an item is the bot's judgement: something that will outlive this turn. A request settled in the same turn never becomes one.
- **The owner**, from the chat ("drop the flight one") or the Work page: open, rename, edit notes, close, drop, and **Cancel** its running background work.
- **The runtime**: a scheduled job opens its item when the job is saved and keeps `nextAt` and `result` current; a handoff opens an item on each side; an item's session finishing a turn updates its `result`.

## In every turn

The open items go with each message, in `messageContext` beside the sent time, not in the instructions: the list changes often, and changing the instructions would miss the prompt cache.

```
[Open work (3)]
w-12 Flights to Lisbon: waiting on the owner (pick a date); last: two options sent Nov 25
w-14 Morning brief: job, next run Nov 27 07:00; last: sent Nov 26 07:02
w-15 Venue research: waiting on Research
```

One line each, newest activity first, at most 20 items and about 1,500 tokens; past that, the line says how many more and `work_list` shows them. Full notes and results are fetched with `work_read` only when needed. Instructions tell the bot to check this list before answering "what's going on?", to quote an item's source message when its result comes back, and not to open items for one-turn requests.

## Background sessions

An item that needs work done outside the chat gets its own session, created on first use and kept while the item is open, so follow-ups keep its context.

- **Starting it.** `work_start` (item id, brief) sends the brief to the item's session as a turn, like a handoff to oneself. The chat's turn ends at once; the bot tells the owner it is on it.
- **Following up.** `work_start` on an item with a session sends another turn to that same session. The owner's "any news on this?" quoting the item's source message lets the bot find the item.
- **Results.** When the session's turn finishes, its answer becomes the item's `result` and comes back to the chat as a marked turn, the way a handoff's result does today, framed as data. The chat's model then tells the owner, quoting the source message. Approvals and questions from the session already reach the owner through the inbox; showing them as cards in the chat is a later step.
- **Cancel** stops the item's running turn only. **Stop** in the chat stops only the chat's reply.
- **Keeping sessions.** The cleanup at start removes sessions the owner can't write in. An item's session is marked (`ChatConversation.work = itemId`) and kept while its item exists, closed or not, so its history stays readable.

## Scheduled jobs

A job is an item with `origin: job`. Each run is a turn in the item's session (with the saved instruction, as now), so the job keeps its own history between runs. The run's answer posts into the chat as the bot's message, marked with the job's name and linked to the item; the chat's model does not rewrite it. Removing the job closes the item; pausing it sets the item to `waiting` until resumed.

This reverses the chat runs from PR #163: the chat holds each run's result, not its prompt and full reply.

## Handoffs

A handoff opens an item on each side. The sender's item (`handoff-sent`) waits on the other bot; its `result` is the handoff's result. The receiver's item (`handoff-received`) is marked with the sender, and its session is the session the handoff already runs in. `handoff_list` and the sender's handoff panel become the sender's work items; `handoff_follow_up` and `handoff_read` keep working, keyed by the item.

## Owner surfaces

- **Work page** (web and desktop, same PR): open items first, then Done; each opens to its notes, result, source message and a link to its messages in the chat. Actions: rename, edit notes, close, drop, Cancel. Never beside the chat.
- **Chat**: results and job messages carry a small link to their item.
- **API** (`@raphie/contracts`): `GET /work-items?status=open|closed&q=`, `GET /work-items/:id`, `POST /work-items` (owner opens one), `PATCH /work-items/:id` (title, notes, status), `POST /work-items/:id/cancel`, and an SSE stream like `/sessions/events`.

## Other interactions

- **Reset** deletes all items with the chat and jobs.
- **Rewind** (not built) tells the bot which items its rewound turns opened, so it doesn't open them twice.
- **Memory** is unchanged: lasting facts go to memory; work items hold what is in progress.

## Slices

Each slice ships on its own, with web and desktop together where it has a screen.

1. **Record and tools.** The document, `work_open/update/close/read/list`, the per-message list, instructions, and the API read endpoints. The bot can track threads; nothing runs in the background yet.
2. **Work page** on web and desktop, with the owner's actions.
3. **Background sessions**: `work_start`, results back to the chat, Cancel, keeping item sessions in the cleanup. Done in #168; results don't quote the source message yet.
4. **Jobs as items**: runs in the item's session, results posted to the chat, PR #163's chat runs removed. Done: a job's item follows the job's lifecycle, and the owner changes it through the job, not the Work page.
5. **Handoffs as items** on both sides; the handoff list folds into work items.
6. **Approvals and questions as chat cards** from background sessions.

## Open questions

- **Posting without a model turn.** Settled in slice 4: a `write` submission to the chat's conversation adds the post to the model context with no request, and the chat records it as a finished bot message. The home channel gets the run's reply from the run itself, so it is sent once.
- **One session, two received handoffs.** Handoffs from the same sending session join one receiving session today. Two received items would then share a session, so Cancel on one would stop the other. Decide before slice 5: one item per sender-receiver thread, or one session per handoff.
- **A post during a chat reply.** A job's result is written to the chat with a Pi `write`, which the model reads at the next boundary like a steer. If a chat reply is mid-run, the model sees the "[Your scheduled job …]" note partway through it. Check that this is harmless with a tool-calling reply, or hold posts until the chat is idle.
- **Jobs crowding the list.** A bot can have 100 jobs, each an open item, and the list shows 20. Order requests and waiting items ahead of idle jobs, or show jobs as a count.
- **Late results on a closed item.** Settled in #168: closing an item, by the owner or the bot, stops its running turn, and a run that ends on a closed item records its result without posting it to the chat.
- **Too many items.** If the bot opens items too eagerly the list becomes noise. The instructions and the 20-item cap are the first defence; measure how many items real use creates before adding rules.
- **Matching follow-ups.** "How's the Lisbon thing going?" without a quote relies on the bot matching titles. Search in `work_list` helps; transcript search (from the research) would help more.
