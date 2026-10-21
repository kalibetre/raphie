# Raphie

Raphie assists its owner through conversations and connected actions. These terms
apply consistently to the web workspace and the agent runtime.

## Language

**Session**: A durable conversation with its own identity and ordered history,
independent of the interface through which the owner participates.
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
