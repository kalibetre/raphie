# Work items own their background runs, on both sides of a handoff

[ADR 0001](0001-one-chat-per-bot-with-work-items.md) made work items the way a bot keeps parallel work apart. This settles three questions it left open.

- **A scheduled job is a work item, and its runs happen in that item's background session.** Only a short result, quoting what started the job, posts into the chat. The job's session keeps its history from run to run, and the chat's context stays small. This replaces running each job directly in the chat, which every run made longer.
- **A handoff is a work item on both sides.** The sending bot keeps an item waiting on the other bot, and the receiving bot keeps one marked with the sender. The sender's separate handoff list goes away, so "what's going on?" has one answer.
- **Closed items are kept.** Done and dropped items stay on the Work page, listed apart from open ones, and the bot can read them. Only open items are in every turn's context. A reset deletes them.

## Considered options

- **Keep job runs in the chat.** Rejected: each run's prompt and full reply would stay in the chat's context, and the projects we studied all keep background work out of the main conversation ([research](../research/README.md)).
- **Track a handoff only on the receiving side.** Rejected: the sender would answer "what's going on?" from two places, its work items and its handoffs.
- **Prune closed items after a month.** Rejected: the Work page is where the owner looks back at what a bot did.

## Consequences

- PR #163's job runs in the chat move to the item's session; `ScheduledJob` gains a work item.
- Received handoffs keep using the receiving bot's background session, now as that item's session.
- ADR 0001's note on sessions from before chats is superseded: they are removed on start, not kept as history.
