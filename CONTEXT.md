# Raphie

Raphie assists its owner through chats with its bots and connected actions. These terms
apply consistently to the web workspace and the agent runtime.

## Language

**Bot**: A persistent Raphie assistant identity with its own instructions,
permissions, configuration, sessions, memory scope and workspace.
_Avoid_: Runtime or session as a synonym for a bot.

**Personality**: A bot's voice, values and interaction style, written by the
owner, picked from a built-in one, or saved by the bot itself when the owner
allows its self-updates. Personality guides its behavior without granting
capabilities or access.

**Self-updates**: What a bot may change by itself, per bot: its own
personality and instructions, the owner profile, and its
skills. Each change
is saved at once and can be undone.

**Instructions**: What a bot follows in every turn about how to
work: what the owner wants done every time, and how to use its tools. Raphie's
instructions for every bot cover the tools every bot has; they ship with each
release and nobody edits them. Each bot's own, kept in its profile, start
empty and are kept by the owner and that bot together. Instructions grant
nothing.
_Avoid_: Standing rules, a separate list beside instructions; instructions
of the owner's for every bot; a purpose per MCP connection; using memory for
what must be done every time, since a bot searches memory only when it thinks
to.

**Skill**: Instructions for one kind of task in the standard Agent Skills
format: a folder in a bot's workspace, `skills/<name>/`, holding a `SKILL.md`.
A bot sees every skill's name and description and reads a skill only when a
task matches it. Skills never grant capabilities.

**Owner profile**: What the owner tells every bot about themselves: their
name, what to call them, their time zone and a few lines about them. Shared by
every bot; it describes the owner and grants nothing. Shown as **You** in
Settings.
_Avoid_: User profile, account, About you.

**Workspace**: A bot's persistent working files and artifacts, shared by its
sessions and preserved when its execution environment stops.
_Avoid_: Web workspace when referring to stored bot files; that names the client UI.

**Sandbox**: A replaceable execution environment that operates on a bot's
workspace within its permitted capabilities.

**Execution**: One bounded operation against a workspace, associated with the
bot and the session that requested it.

**Compute lease**: Temporary, exclusive use of native execution capacity for a
bot's work.

**Chat**: The one ongoing exchange between the owner and a bot, like a direct
message with a teammate. Every client and every private channel chat with that
bot shows the same chat; the owner never starts, lists or archives chats. A
channel group has its own chat with the bot, because others read it.
_Avoid_: Conversation, which suggests the owner opens and juggles many; chat
as a synonym for a single message or a temporary browser connection.

**Session**: A bot's model context with its own ordered history: the one
behind a chat, or one the bot runs in the background for longer work. The
owner follows background work through the chat, never by opening its session.
Sessions from before chats existed are removed when the runtime starts.
_Avoid_: Conversation; session as something the owner picks or starts.

**Work item**: Something a bot is keeping track of for longer than one turn:
a request with follow-ups, a scheduled job, or a handoff it received. It has a
title, a status, notes and its latest result, and the bot keeps its list of
open work items in mind in every turn of the chat. The bot opens and closes
work items itself; the owner can also open, rename, close or drop one. Work
that needs a background session keeps that one session for as long as the item
is open, so follow-ups keep its context. Requests settled in one turn never
become work items. The owner mostly asks the bot about its work items; they
are also listed on the bot's Work page, never beside the chat.
_Avoid_: Task, which named handoffs before; thread; conversation.

**Rewind**: Taking a chat back to just before one of the owner's messages,
to edit and send it again. Only the chat goes back: the later messages stay in
the transcript marked as rewound, and the bot is told what they did outside
the chat (actions taken, work items opened, jobs scheduled) so it does not
repeat them. A rewind can be undone.
_Avoid_: Undo, which suggests effects outside the chat are reversed.

**Reset** (of a bot): Returning a bot to new: its chat, work items,
scheduled jobs and memory are deleted, while its configuration and workspace
files are kept. Nothing of the cleared chat stays to read.
_Avoid_: Clear chat, new conversation.

**Turn**: One admitted message and the agent work that answers it: usually the
owner's in a chat, but also a scheduled job's prompt or another bot's handoff
in a work item's session. A turn may
include several model responses and tool actions before it finishes.

**Quote**: A message's pointer to one earlier message in the same chat, the
owner's or the bot's, shown with its author and an excerpt. Either side
quotes to say which earlier message it is talking about; the bot also quotes
the owner's request when the work it asked for comes back. A message quotes
at most one other. In Telegram and Discord a quote is their native reply when
the quoted message is in that chat.
_Avoid_: Reply for a bot's message, which suggests it only ever answers the
latest one; thread.

**Summary** (of earlier messages): What a session's model reads in place of
its earlier messages once the session grows near the model's context window.
The transcript keeps every message; only the model's context is shortened.
Pi calls the step compaction.
_Avoid_: Memory, which is what a bot keeps across sessions.

**Handoff**: A work item one bot gives another of the owner's bots, with the
brief, its follow-ups and the results that come back. It appears among the
receiving bot's work items, marked with the sender, and the receiving bot
works on it in the background; its chat with the owner shows only a note.
Only the sending bot directs it, though the owner may write to it. A handoff
never carries the owner's authority.
_Avoid_: Delegation or bot message as names for it.

**Approval**: An owner decision about an exact proposed action and its arguments.
Approval does not itself prove that the action executed successfully.

**Question** (from a bot): Something a bot asks the owner mid-turn with
`ask_owner`, offering two to six answers. The turn waits for the answer, which
goes back to the bot as the tool's result. Unlike an approval, it settles no
action: the bot decides what to do with the answer.

**Card**: What a bot shows under its reply in place of a list: rows, the
events of one or more days, the columns of a board, or one task opened up,
drawn by the client from a fixed set of parts. A card is a snapshot of what the bot read, with links out; it
settles nothing and takes no input.
_Avoid_: View, which names a read model; widget.

**Command permission mode**: A bot's Ask or Full access setting for
workspace command tools. It does not authorize MCP calls or change sandbox limits.

**Command grant**: Permission to repeat a command tool's exact arguments
for the same bot, until revoked. It persists across restart
and does not authorize other commands or MCP calls.

**Action**: A proposed or attempted effect in a connected service. An uncertain
action may have executed and must not be repeated automatically.

**Attachment**: A file supplied by the owner or produced by an approved action.
Its display name is metadata, not its storage identity.

**Activity**: An observed event in an agent run, including model, tool, approval,
and recovery progress. Activity is not private model reasoning.

**Memory evidence**: A selected fact or confirmed experience retained across
sessions, with its source and event time. It belongs to the configured runtime
memory scope, rather than to a single session. Current evidence is separate from
historical transcripts and tool outputs.

**Memory backend**: The configured store and retrieval adapter. The first slice
supports built-in SQLite evidence and Hindsight; Honcho and Markdown remain
planned. Switching backends preserves data without copying or merging it.

**Reflection**: Reasoning from retained evidence, with support and uncertainty.
Built-in memory supplies evidence for the bot's model to synthesize;
Hindsight can supply provider reflection. An inferred reflection is not a new
confirmed fact unless explicitly retained as such.

**Channel**: An external messaging platform through which the owner communicates
with Raphie, such as Discord or Telegram.

**Client**: An application through which the owner interacts with Raphie, such as
the web workspace, a desktop application, or a CLI.

**Channel binding**: The association between an external messaging chat and a
bot's chat: a private chat joins the owner's chat with that bot, and a group
gets the group's own chat. A binding identifies where messages belong.

**Actor**: The person making a request or approval decision. Using a different
client or channel does not change that person's authority.

**Delivery**: A tracked attempt to present a reply or approval request at its
intended destination. An uncertain delivery may have reached that destination
and must not be repeated blindly.
