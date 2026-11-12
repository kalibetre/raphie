# Telegram channel

A bot can be reached through Telegram in a private chat with its own Telegram bot.
It uses the same shared operations as Discord and the web workspace: runtime-issued
actor contexts, durable [channel bindings](../CONTEXT.md), a per-turn frozen reply
destination and the scoped delivery worker. See [HTTP interface](headless-interface.md)
for the shared design and [credential storage](provider-credential-storage.md)
for how the token is protected.

> **Live behaviour is unverified.** The adapter was built and tested against a local
> fake of the Telegram Bot API (`packages/runtime/test/fake-telegram.ts`). No real
> Telegram bot or token was used. Treat the first real conversation as acceptance
> testing, starting with a throwaway bot and a harmless tool.

## Set up

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot` and copy
   the bot token. Keep it secret: anyone with it can act as that bot.
2. In Raphie open **Settings → Channels → Telegram → Connect**, paste the token and
   choose **Save and connect**. Raphie checks it with `getMe`, encrypts it with the
   same credential store as Discord, and starts long polling. The token is never
   returned by the API, shown again, logged or placed in an error message.
3. **Create pairing code**, then open a **private** chat with your Telegram bot and
   send `/pair ABCDE-FGHJK`. The chat replies when your account is verified, and
   Settings lists your numeric Telegram user ID under **Verified accounts**.
4. Send a message. It becomes a conversation labelled with a Telegram icon in the
   web conversation list.

The connection can be turned off (**Receive messages**) without losing the token or
verified accounts, a verified account can be revoked, and **Remove Telegram** deletes
the token, verified accounts and saved polling offset for that bot.

One Telegram bot can be connected to one Raphie bot at a time. A second Raphie bot
trying to use it gets a conflict; on startup the first bot in profile order wins and
the others report "connected to another Raphie bot".

## How owner verification works

Telegram usernames can be changed and claimed, so they are never trusted. Identity is
the immutable numeric user ID Telegram reports for a private chat.

- The code is 10 characters from an unambiguous 32-letter alphabet (50 bits), created
  from the Node CSPRNG, valid for **10 minutes** and **single use**. Only its SHA-256
  hash is kept, **in memory only**: a restart discards it, it is never written to
  SQLite or the logs, and Settings shows it once.
- Five wrong guesses invalidate the live code. Strangers can therefore only waste a
  code, not guess it; create another one.
- Only a private chat where the sender is the chat (`from.id == chat.id`) can pair or
  submit. Group, supergroup and channel messages are ignored without a reply.
- An unverified private chat that writes to the bot receives one refusal explaining
  how to pair (at most once per ten minutes per chat, counted in memory) and nothing else. Its messages
  never reach a model, memory or the workspace.
- Verified IDs are stored in the same encrypted blob as the token. Revoking takes
  effect for the next update, including pending button presses.

Several accounts can be verified; each has its own private chat, binding and session.
As with Discord, only the **initiating** verified account can decide a tool approval
from Telegram; the owner can always decide in the web workspace.

## What happens to a message

1. The adapter long-polls `getUpdates` for `message`, `edited_message` and
   `callback_query` updates, one at a time and in order.
2. A verified owner's text is admitted through `application/sessions` with the event
   ID `<telegram bot id>:<update id>`. The chat is bound to a session in
   `ChannelBindings`, scoped by owner, the connection `telegram:<bot id>` and the
   conversation `telegram:<chat id>`. The reply destination is frozen on each turn,
   so later configuration changes cannot redirect it.
3. Replies and approval prompts are rendered to persisted Telegram operations
   **before** any network call. A worker scoped to this one Telegram connection
   claims and sends them. It cannot see Discord or another Telegram bot's work.
4. A tool proposal arrives as a message with the exact arguments and **Approve once**
   / **Decline** inline buttons. A decision runs the shared approval operation, which
   keeps the first decision: a repeat, stale or opposite press is answered with the
   current state and never executes the tool again. A web decision on the same
   approval wins the same way, and the Telegram message is edited to remove its
   buttons.

## Delivery, limits and recovery

| Topic                 | Behaviour                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message size          | Telegram allows 4,096 characters. Replies are chunked at 4,000 inside the adapter (at a line or word boundary when one is near, never inside a surrogate pair). The shared delivery interface still sees one whole reply.       |
| Formatting            | Model replies are sent as **plain text**: Markdown and Mermaid blocks are not rendered, and nothing in a reply can be parsed as markup. Approval prompts use Telegram HTML and escape every dynamic value (`&`, `<`, `>`).      |
| Approval arguments    | Shown in the prompt as pretty JSON. If they do not fit, the prompt says so and the **complete** JSON follows as a document (up to 8 MiB); beyond that the prompt directs you to the web workspace. Review before approving.     |
| Rate limits (429)     | Telegram answers 429 before doing any work, so the adapter waits `retry_after` (1–60 s) and repeats the same call, up to four times, without risk of a duplicate.                                                               |
| Other failures        | A timeout, 5xx or 4xx on a send leaves the operation **uncertain**. It is not repeated automatically; later chunks of the same reply are still sent. A stored plan survives restarts.                                           |
| Crash during delivery | A hard kill while sending marks that chunk uncertain on the next start; only the remaining chunks are sent. Tests kill the process with SIGKILL for both a confirmed and an unknown first chunk.                                |
| Inbound dedupe        | The next `getUpdates` offset is committed after each handled update in `telegram.sqlite` and used after a restart. If the process dies in between, the redelivered update is rejected by the durable event ID instead of rerun. |
| Offline               | Startup never waits for Telegram. Settings reports "Cannot reach Telegram", "token rejected" or "another poller or webhook" while retrying with a 1–30 s backoff.                                                               |

`getUpdates` fails with a conflict if the bot has a webhook or another poller. Raphie
does not delete webhooks for you; remove the webhook with Telegram's `deleteWebhook`
or use a bot dedicated to Raphie. Webhooks are not supported because they would
require exposing the runtime to the internet.

## Not supported

Each of these gets an explicit message in Telegram rather than being ignored:

- photos, files, voice, stickers and other attachments (text only);
- the `/copy` file-approval experiment;
- edited messages (an edit is not re-submitted; send a new message);
- Markdown rendering of replies.

Not handled and silently ignored by design: group, supergroup and channel chats, and
anything from an unverified account other than the one-time refusal.

Also out of scope, as in the [roadmap](roadmap.md): linking a Telegram chat to an
existing web session, broadcasting, automatic identity matching and copying
transcripts. A Telegram chat has its own session and cannot address another one.

## Scheduled jobs

A scheduled job turn carries no reply destination, for every channel. Its answer is
visible in the web workspace and is never sent to Telegram, even if the job's session
began in a Telegram chat. Making a job answer where it was created would need the
destination to be captured at creation, which does not exist yet.

## Security notes and trade-offs

- **The token is the bot.** It is encrypted at rest, never returned and redacted
  from activity, but anyone with the host account, the credential key and the
  database can use it. See [credential storage](provider-credential-storage.md).
- **Telegram sees everything.** Bot API chats are not end-to-end encrypted, so
  prompts, replies and approval arguments pass through Telegram's servers.
- **A compromised Telegram account is a compromised owner.** Anyone who can use a
  verified account can approve tool actions. Protect it with two-step verification
  and revoke it in Settings if the device is lost.
- **Pairing codes are shown in the browser.** Anyone who can open Settings can create
  one; the code expires in 10 minutes and works once.
- **Long polling is outbound only.** The adapter opens connections to
  `api.telegram.org` over HTTPS, follows no redirects and has no inbound listener.
- **Stranger traffic is bounded**: one refusal per chat per ten minutes, no model
  access, and no data stored beyond the poll offset.
- **No Markdown means no markup injection**: model text can never inject HTML or
  links into a Telegram message.
- The `discordThreadId` and `discordUserId` fields in stored turns and approvals are
  legacy names. They now hold the external conversation and verified user ID for any
  channel, avoiding a data migration.

## Storage and tests

`bots/<id>/telegram.sqlite` (the default bot's is under the data directory) holds one
encrypted row (token, bot ID and username, enabled flag, verified user IDs) and the
polling offset. Channel bindings and delivery plans live in the existing durable
documents.

`packages/runtime/test/telegram.test.ts` and `telegram-delivery.test.ts` use temporary
databases, the real Gateway with the mock model and a fake Bot API; none makes a model
or network call. They cover verification and stranger refusal, offset recovery and
duplicate updates, message → approval → exact execution → reply without a web process,
stale and repeated buttons, a web decision settling a Telegram approval, chunking, 429
handling, uncertain sends, SIGKILL recovery and the settings API. Run
`bun test packages/runtime/test/telegram`.
