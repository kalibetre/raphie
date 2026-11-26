# One chat per bot, with work items instead of conversations

Bots are meant to be teammates, and nobody opens a new conversation with a teammate for every topic. So each bot has exactly one chat with the owner, shared by every client and private channel chat. Parallel work is kept apart by **work items** that the bot keeps, not by conversations the owner manages. Sessions stay inside the runtime as the unit of model context: one behind the chat, and one per work item that needs background work. The owner never opens a session directly.

## Considered options

- **Threads in one chat** (Slack-style). Rejected because each thread is a conversation under another name, and the owner would be managing them again.
- **One chat plus memory and summaries of earlier messages only.** Rejected because the bot searches memory only when it thinks to, and summaries lose detail, so parallel work would bleed together or be forgotten.
- **Work items** (chosen). The bot keeps a list of open items in every turn's context, so it can track several things at once. Background sessions per item keep the chat responsive and its context small.

## Consequences

- Scheduled jobs and received handoffs become work items. Their results post into the chat, and they no longer get their own conversations.
- Model choice, Ask/Full access and command grants move from per session to per bot. A command grant now covers everything that bot does, not one conversation.
- **Stop** stops only the chat's current reply. Each work item has its own **Cancel**.
- Work items are not shown beside the chat. The owner asks the bot about them or opens the bot's **Work** page. Approvals and questions from background work come to the chat as cards.
- There is no new conversation. In its place, a **rewind** takes the chat back to just before one of the owner's messages (only the chat; the bot is told what happened outside it so nothing is repeated), and a **reset** returns the bot to new.
- Sessions that existed before this change are kept as read-only history and never merged, so memory's source links still work.
