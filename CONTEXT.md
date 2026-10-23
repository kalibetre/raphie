# Raphie

Raphie assists its owner through conversations and connected actions. These terms
apply consistently to the web workspace and the agent runtime.

## Language

**Bot**: A persistent Raphie assistant identity with its own instructions,
permissions, configuration, sessions, memory scope and workspace.
_Avoid_: Runtime or session as a synonym for a bot.

**Personality**: A bot's owner-authored voice, values and interaction style.
Personality guides its behavior without granting capabilities or access.

**Workspace**: A bot's persistent working files and artifacts, shared by its
sessions and preserved when its execution environment stops.
_Avoid_: Web workspace when referring to stored bot files; that names the client UI.

**Sandbox**: A replaceable execution environment that operates on a bot's
workspace within its permitted capabilities.

**Execution**: One bounded operation against a workspace, associated with the
bot and the session that requested it.

**Compute lease**: Temporary, exclusive use of native execution capacity for a
bot's work.

**Session**: A durable conversation with its own identity and ordered history,
belonging to one bot, independent of the interface through which the owner
participates.
_Avoid_: Chat as a synonym for a single message or a temporary browser connection.

**Turn**: One admitted owner message and the agent work that answers it. A turn may
include several model responses and tool actions before it finishes.

**Approval**: An owner decision about an exact proposed action and its arguments.
Approval does not itself prove that the action executed successfully.

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
Built-in memory supplies evidence for the conversation model to synthesize;
Hindsight can supply provider reflection. An inferred reflection is not a new
confirmed fact unless explicitly retained as such.

**Channel**: An external messaging platform through which the owner communicates
with Raphie, such as Discord or Telegram.

**Client**: An application through which the owner interacts with Raphie, such as
the web workspace, a desktop application, or a CLI.

**Channel binding**: The association between an external messaging conversation
and a Raphie session. A binding identifies where messages belong; it does not
imply that the session is shared with other conversations.

**Actor**: The person making a request or approval decision. Using a different
client or channel does not change that person's authority.

**Delivery**: A tracked attempt to present a reply or approval request at its
intended destination. An uncertain delivery may have reached that destination
and must not be repeated blindly.
