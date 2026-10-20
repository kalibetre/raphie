# Raphie

Raphie assists its owner through conversations and connected actions. These terms
apply consistently to the web workspace and the agent runtime.

## Language

**Session**: A durable conversation with its own identity and ordered history.
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

**Channel**: A way the owner participates in a session, such as web or Discord.
Changing channels does not create a second execution of the same message.
