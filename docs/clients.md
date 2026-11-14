# Clients: what each one can do

Raphie has one owner and several clients: the web workspace in a browser, the
[desktop client](desktop.md), and later a mobile client. This page says which
client offers what, and why some things stay in the browser.

Agreed with the owner on 2026-11-14. No mobile client exists and none is on
the [roadmap](roadmap.md) yet, so the Mobile column records intent only.

## The rules

A new feature is placed by asking these questions in order.

1. **Does it grant or remove access to Raphie?** Then it is **web only**, and
   the web host enforces that, not the client. Password and passkey sign-in,
   approving a device, and listing or disconnecting devices answer only to a
   signed-in browser. A device token is refused, so a lost or stolen device
   cannot lock the owner out or add another device. Recovery stays on the
   Raphie machine (`raphie auth recover`).
2. **Does it belong to the browser itself?** Then it is **web only**: UI
   plugins and the web workspace's own theme.
3. **Does one step need a browser?** Then a native client does the rest and
   **hands that step to the browser**: approving this device, and authorizing
   an MCP server with OAuth.
4. **Otherwise it can be native.** An approved device already has the owner's
   full authority over conversations and bot settings: the web host accepts its
   token for every runtime route. Offering a page natively adds no new access;
   it only saves a trip to the browser.
   - **Desktop** gets everything in this group.
   - **Mobile** gets what is useful away from the desk: conversations,
     approvals, and light settings. Setup pages that are used rarely and are
     awkward on a phone (provider keys, MCP servers, channels, sandbox, memory
     back end, creating or deleting a bot) stay on web and desktop.
5. **Does it use this computer?** Local speech-to-text, computer use and the
   owner's real browser are **desktop only** (the planned _desktop host_ role).

## The matrix

- **Yes**: delivered.
- **Planned**: agreed to build, not built.
- **Browser**: the client opens the web workspace for it.
- **No**: not offered there, on purpose.

### Access and identity

| Capability                                   | Web | Desktop | Mobile  | Why                                          |
| -------------------------------------------- | --- | ------- | ------- | -------------------------------------------- |
| Sign in with password or passkey             | Yes | No      | No      | Rule 1. Native clients use a device code.    |
| Sign in with a device code                   | –   | Yes     | Planned | The native sign-in.                          |
| Approve a device                             | Yes | Browser | Browser | Rule 1, handed over as in rule 3.            |
| List and disconnect devices                  | Yes | Browser | Browser | Rule 1. The web host refuses device tokens.  |
| Register or remove passkeys                  | Yes | Browser | Browser | Rule 1. Passkeys are tied to the web origin. |
| See who is signed in, and the Raphie address | Yes | Yes     | Planned | Rule 4.                                      |
| Sign this client out                         | Yes | Yes     | Planned | Rule 4. Forgets only this client's sign-in.  |
| Recover access (`raphie auth recover`)       | No  | No      | No      | Rule 1. On the Raphie machine only.          |

### Conversations

| Capability                                    | Web | Desktop | Mobile  | Notes                                                                             |
| --------------------------------------------- | --- | ------- | ------- | --------------------------------------------------------------------------------- |
| Bots and conversations, search                | Yes | Yes     | Planned |                                                                                   |
| Read, streamed replies, earlier messages      | Yes | Yes     | Planned |                                                                                   |
| Send, Stop, queue or steer a message          | Yes | Yes     | Planned |                                                                                   |
| Tool steps, reply time, tokens and cost       | Yes | Yes     | Planned |                                                                                   |
| Approve or reject; approve for session        | Yes | Yes     | Planned |                                                                                   |
| Attachments                                   | Yes | Planned | Planned |                                                                                   |
| Choose the model for a conversation           | Yes | Planned | Planned |                                                                                   |
| Command mode (Ask or Full access), grant list | Yes | Planned | Planned |                                                                                   |
| Unread markers and the "New replies" filter   | Yes | Planned | Planned | Read state is kept per client today, not shared.                                  |
| Notifications                                 | Yes | Planned | Planned | In-app on web. System notifications on desktop. Push on mobile needs server work. |

### Bot settings

| Page                                       | Web | Desktop | Mobile  | Notes                                                                           |
| ------------------------------------------ | --- | ------- | ------- | ------------------------------------------------------------------------------- |
| Profile: name, description, colour         | Yes | Yes     | Planned |                                                                                 |
| Personality (SOUL.md)                      | Yes | Yes     | No      | Long-form editing. Saved with the profile.                                      |
| Personality revision history               | Yes | Planned | No      |                                                                                 |
| Create a bot, delete a bot                 | Yes | Planned | No      | Rare, and deleting cannot be undone.                                            |
| Providers (model connections and keys)     | Yes | Yes     | No      | Setup. Keys are typed into a masked field and sent once; the client keeps none. |
| Models (compare, pick the default)         | Yes | Yes     | Planned |                                                                                 |
| Memory settings                            | Yes | Planned | No      | Setup.                                                                          |
| Browse, correct or forget memory           | Yes | Planned | Planned |                                                                                 |
| MCP tools                                  | Yes | Planned | No      | Setup. OAuth authorization opens the browser.                                   |
| Channels (Discord, Telegram, home channel) | Yes | Planned | No      | Setup.                                                                          |
| Sandbox                                    | Yes | Planned | No      | Setup, and it decides how commands run.                                         |
| Workspace files: browse, download          | Yes | Planned | Planned |                                                                                 |
| Scheduled jobs and their run history       | Yes | Planned | Planned |                                                                                 |
| Diagnostics, telemetry switch              | Yes | Planned | No      |                                                                                 |
| Activity                                   | Yes | Planned | Planned |                                                                                 |

Until a "Planned" desktop page is built, the desktop client shows its header
and an **Open in browser** button for the same page of the web workspace.

### The app itself

| Capability                        | Web | Desktop | Mobile  | Notes                             |
| --------------------------------- | --- | ------- | ------- | --------------------------------- |
| Appearance (light, dark, system)  | Yes | Yes     | Planned | Each client keeps its own choice. |
| UI plugins                        | Yes | No      | No      | Rule 2.                           |
| Local speech-to-text              | No  | Planned | No      | Rule 5.                           |
| Computer use, the owner's browser | No  | Planned | No      | Rule 5.                           |

## What enforces this

- **Rule 1 is enforced by the web host**, in
  `apps/web/src/infrastructure/auth/gateway.ts`: the passkey and
  connected-device routes require a browser session cookie and answer 401 to
  any request that carries an `Authorization` header. See
  [Authentication](authentication.md#connect-a-native-device).
- **Everything in rule 4 is allowed by the web host** for a device token: it
  proxies `/api/...` runtime routes for bearer sessions. Which of those a
  client shows is a product choice recorded in this page, not a server rule.
- A change that moves a row out of "web only" under rule 1 is a security
  change to the web host. It needs its own decision, not just client work.

## Keeping this page true

Update the matching row in the same change that delivers a capability on a
client, and move it from Planned to Yes. Add a row when a new capability
appears, placing it with the rules above.
