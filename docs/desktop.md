# Desktop client

Raphie Desktop is a native app for the daily loop: sign in, pick a bot and a
conversation, read and send messages with replies streaming in, and approve or
reject tool actions. It is written in Rust with [Rune](https://github.com/anomalyco/rune),
a GPU-rendered UI framework, and lives in `apps/desktop`.

It is a **client of the web host's authenticated API**, the same API the web
workspace uses. It never talks to the runtime's port 4316, so it works the same
whether Raphie runs on this machine or on a server reached over a tailnet.

What belongs in this app and what stays in the browser is set out in
[Clients: what each one can do](clients.md).

It looks like the web workspace on purpose: the same colours, type, bot faces,
icons and layout, in light and dark.

Screenshots are not kept in the repository. `scripts/snapshots.sh` renders
every screen in light and dark from made-up data; see
[Headless snapshots](#headless-snapshots) below.

## What works

Delivered in this first version (macOS first; see [Limits](#limits)):

- **Device sign-in** against any configured origin, using the flow in
  [Connect a native device](authentication.md#connect-a-native-device). The app
  shows the code and the approval link, polls at the host's interval (never
  faster than every 5 seconds, slower when asked), and refuses an approval link
  that points at a different origin.
- **Token storage** in the OS credential store: the login Keychain on macOS
  (service `dev.raphie.desktop`, or `dev.raphie.desktop.dev` for the dev
  build; one entry per origin). The token is never
  written to a file or a log. At launch the app reuses a stored token for the
  last origin; if the host answers 401 (the device was disconnected in
  Settings → Account, or the password was recovered), the token is deleted and
  the app returns to sign-in with an explanation.
- **Raphie on this Mac** is found by itself. The installer saves its ports in
  `~/.local/lib/raphie/.ports`; the app reads the web port there (24320 when
  none was saved) and asks `/_raphie/health` at launch and each time it is
  back on the sign-in screen. Before it has signed in anywhere, the release
  app offers that address; the dev app offers the test fixture
  (`http://127.0.0.1:4321`). When a Raphie answers on this Mac and the field
  holds another address, for example one that no longer answers, the sign-in
  card offers it: **Use it** fills it in and connects.
- **Bots and conversations** from the focused client queries: the bot roster
  (`GET /api/bots`), each bot's live session list (`/api/sessions/events`, plus
  "Load more conversations" pages), and bot-prefixed routes for named bots. The
  conversations panel (the button at the top right) searches titles and
  filters to conversations with new replies or that need an approval. ⌘B
  hides the roster. In a window too narrow to keep the conversation at least
  560 pt wide beside the roster and the panel, the panel floats over the
  conversation instead, as the web's sheet does: picking a conversation, its
  close button, Escape or a press outside closes it.
  Dragging the inner edge of the roster or of a docked panel resizes it, as
  on the web: the roster from 220 to 480 pt, the panel from 280 to 640 pt.
  The widths are kept in the settings for the next launch; a window too
  small for them draws them narrower without forgetting them.
- **New replies**: a conversation with replies you have not read shows a dot,
  a bolder title and "2 new replies"; the panel's button, its tab and each
  bot's row in the roster count the conversations that need you (new
  replies or an approval). Replies count as read when their
  conversation is on screen, scrolled to its end, in the window in front,
  as on the web. What was read is shared through Raphie
  (`POST /api/sessions/<id>/read`), so a reply read on the web, or on
  another computer, is read here too; the furthest any client has read
  wins. It is also kept on this computer (`read-replies.json` beside the
  settings), per Raphie and per bot, for a Raphie too old to share it.
- **Notifications**: the bell in the bar counts what waits across every bot
  and opens the inbox in place of the conversation: new replies, actions
  waiting for approval and scheduled-job runs, newest first, under Today and
  Earlier, with All, Replies, Approvals and Jobs tabs. Selecting an update
  opens its conversation (in whichever bot it belongs to); a job update can
  be dismissed with its ✕. The selected bot's conversations come from its
  live list; the other bots' first page of conversations and every bot's
  job updates are asked for every 15 seconds.
  An update that arrives while this window is not in front is also posted
  as a system notification, once; in front, the bell is enough. Nothing is
  announced for what already waited when the app started. On macOS this
  needs the app bundle (see "Run it as a macOS app" below): macOS asks once
  whether Raphie may send notifications, and a bare `cargo run` posts none.
  Clicking a notification brings the window forward and opens its
  conversation, as the inbox does (a finished job's run is dismissed on
  the way); one with no conversation, or for a bot deleted since, opens the
  inbox instead.
- **Conversations** from the session event stream (`/api/sessions/<id>/events`):
  history with "Show earlier messages" paging, the reply streaming in as it is
  written, Markdown with syntax-coloured code blocks, selectable text, run
  phase while waiting, and failed or stopped replies. A dropped stream
  reconnects with backoff (1 s up to 15 s) and the roster's status line says
  "Reconnecting…".
- **Sending** with Return (Shift-Return for a new line). Each message has one
  stable event id; a network failure is retried with the same id, so the runtime
  admits it once. A first message creates the session and opens it.
- **What a run did**: under each message, the tools the run used ("Used 2
  tools · 4s"), unfolding to each step's state, arguments and result; under
  each reply, when it finished and its tokens and cost. While Raphie works,
  the same list shows what it is doing and for how long.
- **Stop and steer**: the send button becomes **Stop** while Raphie works. A
  message sent meanwhile is queued, and can be switched between "Queued" and
  "Steering after this step".
- **Attachments**: up to four files of at most 8 MiB each go with a
  message. Add one with the paperclip (the system's file picker), drag files
  from Finder onto the conversation, or paste a screenshot or copied files
  into the message. A file is uploaded to the bot's workspace as soon as it
  is chosen and waits in the composer as a card, which can be removed; files
  alone can be sent without text. A sent message shows its files, and the
  download button on each saves it to this machine's Downloads folder,
  never replacing a file that is already there. An image (PNG, JPEG, GIF
  or WebP) shows its picture: small in the composer's card, and across the
  top of the card on a sent message, as on the web. The picture is fetched
  once (`GET /api/files/<id>`) when the image is in the composer or the open
  conversation, and decoded off the UI thread; the latest 24 are kept, and
  until one arrives, or if it cannot be shown, the card shows the image icon.
  Pressing a picture shows it enlarged over the window, whole, on a dark
  backdrop; a press anywhere, its close button or Escape closes it. The web
  has no such view yet.
- **Model**: the button beside the paperclip names the model the next
  message will be answered with, and opens a list of the bot's models to
  choose another: search by name, id or connection, narrow the list to one
  model family (the part of the id before `/`, as on the web), and star
  models to keep them under Favorites. Up and Down move between the models
  from the search box, and Return picks one. For an open conversation the choice is saved on the
  host at once; for a new one it goes with the first message. Without a
  choice, a conversation uses the bot's default for new sessions. Stars are
  kept on this computer. The model cannot be changed while Raphie works.
- **Command permissions**: the button beside the model names how this
  conversation treats commands, **Ask** (review each command before it runs)
  or **Full access** (run them without asking in this conversation; sandbox
  restrictions and external approvals still apply). An open conversation's
  mode is read from and saved on the host; a new one starts at Ask and sends
  its choice with the first message.
- **Approvals**: pending actions show their server, tool and exact arguments,
  when they expire, and **Reject** and **Approve once**; command approvals
  also offer **Approve for session**. A decision that arrives after the
  approval was settled or expired is reported ("had already been approved",
  "expired before your decision arrived") instead of failing.
- **Settings** (the gear at the bottom of the roster, or ⌘,) open in the app,
  laid out like the web's: every bot's pages, then Account and Appearance.
  - **Account** shows who this device is signed in as and the Raphie address,
    and signs out.
  - **Appearance** pins light or dark, or follows the system. The choice is
    saved on this computer.
  - **About** (desktop only; the web shows its version under Appearance)
    shows Raphie's version (from
    the repository's `VERSION` file, or `RAPHIE_VERSION` at compile time, as
    the web does) and whether a newer release exists. The app checks once at
    launch, and **Check for updates** checks again: it reads Raphie's public
    releases on GitHub with its own HTTP client, never the signed-in one, so
    the host's token is never sent there. A newer release offers **View
    release**, which opens its GitHub page. Nothing is downloaded or
    installed.
  - **Profile** edits a bot's name, description, colour and personality. A
    save bar appears once something changed. If the bot was saved somewhere
    else meanwhile, the draft is kept and saving is blocked until you
    discard it, so nobody's edits are overwritten silently. Unsaved edits
    survive a look at another page.
    - **View revision history** lists the bot's last 50 saved versions,
      newest first. Open one to read the personality it had. History is
      read-only: there is no restore.
    - **Delete bot** (not offered for the default bot) asks you to type the
      bot's name. It removes the bot's profile history, conversations,
      attachments, local memory, connections, scheduled jobs and workspace
      files, and cannot be undone. The host refuses if the name is wrong or
      the bot changed since the page loaded.
  - **Create a bot** is the **+** beside "Bots" in the navigation. It is the
    Profile form with a starter personality. A bot needs a name and a
    personality; afterwards its Providers page opens, since a new bot has no
    model connection yet. A half-written new bot survives a look at another
    page until you Cancel it or create it.
  - **Models** shows the default model for new sessions and the catalogue the
    bot's connections offer, with search and Provider, Model source and
    Connection filters. "Set as default" changes where new sessions start;
    existing sessions keep their model.
  - **Providers** lists a bot's model connections and adds, renames, re-keys,
    tests and removes them. An API key is typed into a masked field, sent to
    the host once, and forgotten when the form closes: the app never stores a
    provider key and never shows or logs one. A subscription (OpenAI's "Sign
    in with ChatGPT") is connected by signing in instead: the page shows
    whatever the provider's sign-in reports and asks (a page to open, a code,
    a question), the same for every provider. A sign-in page opens in the
    browser by itself, as on the web, and a pasted redirect address
    goes in a masked field. An expired subscription shows "Sign in again".
  - **Memory** switches a bot's memory on or off, chooses its back end
    (built-in or Hindsight) and scope, and tests the saved setup. A Hindsight
    API key is typed into a masked field and sent once, or cleared; the app
    never stores or shows it. Edits are saved from a bar under the page, and
    the runtime refuses a change while the bot is working.
  - **Browse memory**, reached from Memory, lists what a bot remembers,
    newest first and a page at a time, with each memory's kind, time,
    revision and source. On the built-in back end typing searches after a
    short pause; on Hindsight, which cannot list every record, Search or
    Return sends the query. Where the back end allows it, a memory can be
    corrected in place or forgotten after a confirmation. "Open source
    session" leaves Settings for the conversation the memory came from.
  - **MCP tools** lists a bot's connections to MCP servers with how each is
    doing, and pauses, reconnects, removes or imports one. The form adds a
    server by URL (with an optional bearer token) or as a local command
    (arguments as a JSON array, environment as a JSON object). The token and
    the environment are typed into masked fields, sent once, and dropped;
    the app never stores or shows them. "Authorize" opens the server's
    sign-in page in your browser. While the page shows it asks the host
    again every five seconds, so a finished authorization appears by itself.
  - **Channels** connects a bot to Discord and Telegram and chooses its home
    channel. Discord takes a bot token, the user IDs allowed to message the
    bot, and an optional channel ID. Telegram takes a bot token, then pairs
    your account with a one-time code, lists and revokes verified accounts,
    and pauses receiving without losing either. Bot tokens are typed into
    masked fields, sent once, and dropped; the app never stores or shows
    them. While a pairing code is out the page asks the host again every
    two seconds, so your account shows as verified by itself. The home
    channel is where scheduled results go: web only, or a known Discord or
    Telegram conversation.
  - **Sandbox** chooses how a bot runs commands: the provider (just-bash or
    Container), the acknowledgement Container needs before it may reach
    services on the Raphie machine and its network, idle minutes and a disk
    quota. Edits are saved from a bar under the page, which also says when
    a number is out of range or the settings changed elsewhere. Below the
    form the page describes the active provider, what the workspace keeps,
    and the execution limits and usage, re-read every five seconds.
  - **Workspace** browses a bot's files a folder at a time, with each
    entry's kind, size and when it changed, and re-reads the folder every
    five seconds. A file's download button saves it into this machine's
    Downloads folder and says what it was saved as. A download never
    replaces a file already there (a second `notes.md` becomes
    `notes (1).md`), and a name from the runtime can never place a file
    outside that folder.
  - **Scheduled jobs** lists a bot's jobs with their schedule, state and
    last run, and runs, pauses, resumes or removes one. "Create job" opens
    a dialog for a name, a prompt, once or recurring, and the first run's
    local date (`YYYY-MM-DD`) and time (`HH:MM`); a draft keeps the dialog
    open. Run history shows recent runs for every job or one job, loads
    older runs from a button, and opens a run's conversation. Jobs and the
    newest runs are re-read every five seconds.
  - **Activity** lists a bot's most recent durable events across its
    conversations, newest first, with a filter and each event's details.
  - **Diagnostics** is an app-wide page beside Account and Appearance,
    because trace collection is one setting of the runtime and its trace
    store is shared. It holds the switch that collects diagnostic traces
    and lists recent exported spans from every bot for the last 1, 6 or 24
    hours, with a filter and each span's bot, ids, status and attributes.

  Activity and Diagnostics are re-read every five seconds, and their
  export buttons save the JSON into this machine's Downloads folder.
  Every Settings page is now in the app; none opens the browser.

- **Light and dark** follow the OS appearance, live, unless Appearance pins
  one.

## Install it

Each release on the [releases page](https://github.com/kalibetre/raphie/releases)
carries the app as `Raphie-macos-arm64.dmg`, built from the same commit as the
runtime beside it. It runs on Apple Silicon Macs (M1 and later) only; there is
no Intel build. The latest stable release is always at
`https://github.com/kalibetre/raphie/releases/latest/download/Raphie-macos-arm64.dmg`.
Nightlies are pre-releases on the same page.

1. Open the disk image and drag **Raphie** onto **Applications**.
2. Open Raphie from Applications. The app is not signed with an Apple
   Developer ID yet, so macOS stops the first launch with "“Raphie” Not
   Opened". Choose **Done**.
3. Open **System Settings → Privacy & Security**, scroll to **Security**, and
   choose **Open Anyway** beside the message about Raphie. Confirm with your
   password, then **Open**. macOS remembers this; later launches open
   normally, until an update replaces the app.

   Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/Raphie.app`.

4. Connect. When Raphie is installed on this Mac, the app finds it by itself,
   at whatever port the installer saved ([ports](user-installation.md#ports)),
   and offers it. For a server, enter its `https://` address
   ([tailnet](#connect-over-a-tailnet)).

To update, download the newer image when **Settings → About** says one exists,
and replace the app in Applications. The sign-in and settings are kept.

## Run it

Prerequisites: a Rust toolchain via [rustup](https://rustup.rs). The pinned
toolchain in `apps/desktop/rust-toolchain.toml` installs itself on first use.

```sh
cd apps/desktop
cargo run --release -p raphie-desktop
```

The first build compiles Rune and its GPU stack and takes several minutes.
`--origin URL` signs in to that origin at launch, for example
`cargo run --release -p raphie-desktop -- --origin http://127.0.0.1:4321`;
otherwise the app reuses the last origin's stored token, or shows sign-in.

### Dev and release builds

A debug build (`cargo run`, `scripts/bundle.sh`) is **Raphie Dev**, and a
release build (`--release`) is **Raphie**. They are separate apps that can be
installed and signed in side by side, so trying a change never disturbs the
app in daily use:

|                  | Raphie Dev                                 | Raphie                         |
| ---------------- | ------------------------------------------ | ------------------------------ |
| Identifier       | `dev.raphie.desktop.dev`                   | `dev.raphie.desktop`           |
| Settings folder  | `<config dir>/raphie-desktop-dev/`         | `<config dir>/raphie-desktop/` |
| Keychain service | `dev.raphie.desktop.dev`                   | `dev.raphie.desktop`           |
| Icon             | The brand face in amber, with a "DEV" pill | The brand face in sage         |
| In the window    | A "DEV" badge beside the brand             | Nothing extra                  |

The release build keeps the names used before the split, so its settings
and sign-in carry over; the dev build starts signed out. The theme is the
same in both. Headless snapshots draw the release look even though they come
from a debug build; the `dev-build` scene shows the badge. The split is
`Flavor` in `core/src/flavor.rs`.

### Run it as a macOS app

```sh
cd apps/desktop
scripts/bundle.sh                    # target/bundle/Raphie Dev.app
scripts/bundle.sh --release          # target/bundle/Raphie.app
open "target/bundle/Raphie Dev.app"  # add: --args --origin http://127.0.0.1:4321
```

`scripts/bundle.sh` wraps the binary in an app bundle with an `Info.plist`
(the build's name and identifier), an icon, and an ad hoc signature. macOS
gives system notifications only to an app with a bundle identifier, so this
is the way to get them: the first launch asks whether the app may send
notifications, once for each of the two apps.

The icon is drawn by the app itself (`app/src/app_icon.rs`), so no image is
kept in the repository: the script runs the debug binary with
`RAPHIE_ICON=dev` (or `release`) and `--snap` to render a 1024 px PNG, and
`sips` and `iconutil` turn it into `AppIcon.icns`. Release builds leave out
Rune's `--snap`, which is why the debug binary draws both.

Both bundles are signed ad hoc, with no Developer ID signature and no
notarisation, which is why a downloaded copy needs **Open Anyway** once.

`scripts/dmg.sh` builds the release app and packs it, with a link to
`/Applications`, into `target/dist/Raphie-macos-arm64.dmg`, on an Apple Silicon
Mac only. It checks the bundle's signature, `Info.plist`, icon and
architecture before packing. `RAPHIE_VERSION` stamps the version the app
shows and compares in its update check. The release workflow runs it on an
Apple Silicon runner, and the **Desktop app** workflow runs it on
pull requests that touch `apps/desktop`, keeping the image as a run artifact
for a week.

### Connect to the test fixture

Use the isolated fixture, never the real app on 4316/4320 or `.data/`:

```sh
bun run dev:fixture          # runtime on 4317, temporary data
bun run dev:web:fixture      # web host on 4321
bun run raphie auth setup    # once, if the fixture's web host is locked
```

Start the app, enter `http://127.0.0.1:4321`, choose **Connect**, then **Open
approval page**. Sign in in the browser, check the code matches, and approve.
The fixture's `acceptance` model streams a canned reply; a message containing
"tool" or "approval" proposes a calendar action that needs your approval. No
paid model is called.

When you are done, disconnect the test device in Settings → Account.

Without the UI, the core has its own live check (like
`scripts/device-auth-smoke.ts`; the token stays in memory):

```sh
cargo run -p raphie-desktop-core --example live -- http://127.0.0.1:4321
cargo run -p raphie-desktop-core --example live -- http://127.0.0.1:4321 --exercise
```

`--exercise` sends two messages, waits for the streamed reply, approves the
fixture's tool action and checks that a second decision is reported as stale.
It makes model calls, so use it only with the fixture.

`bun run raphie auth setup` writes to the web host's data directory, which in a
checkout defaults to the main checkout's `.data/`. To keep the fixture's
administrator separate, give both commands the same throwaway
`DATA_DIRECTORY`.

### Connect over a tailnet

Configure the web host's HTTPS origin first ([tailnet
access](standalone-build.md#tailnet-access)), then enter that origin, for
example `https://raphie.your-tailnet.ts.net`. Plain `http://` is accepted only
for `127.0.0.1`, `localhost` and `[::1]`, so a token never crosses a network
unencrypted. The app follows no redirects.

**Sign out** (the icon at the bottom of the roster) forgets this device's token. The device stays listed in Settings →
Account until you disconnect it there; a native bearer session cannot revoke
itself through the web host today.

## Layout

```text
apps/desktop/
  rust-toolchain.toml     pinned toolchain (matches Rune's)
  Cargo.toml              workspace; Rune pinned to one `dev` rev, plus its patches
  core/                   raphie-desktop-core: no UI framework
    src/contracts.rs      Rust mirrors of the @raphie/contracts types used
    src/origin.rs         origin validation
    src/api.rs            HTTP client for the web host's API
    src/sse.rs            event-stream parser
    src/auth.rs           device sign-in rules, Keychain and in-memory token stores
    src/model.rs          client state and how events change it (pure)
    src/projections.rs    tool steps, usage and run labels from the journal
    src/model_library.rs  grouping, filtering and labelling models
    src/engine.rs         Tokio runtime: sign-in, streams, commands → events
    src/attachments.rs    the files waiting in the composer and their limits
    src/permissions.rs    a session's command mode: what is known, what may change
    src/replies.rs        which replies were read on this computer, and its file
    src/inbox.rs          notifications across bots, and which were announced
    src/settings.rs       last origin, appearance, starred models (non-secret)
    tests/                fake web host (axum) and engine/model tests
    examples/live.rs      live check against a running web host
  app/                    raphie-desktop: the Rune UI
    src/state.rs          UI state, engine bridge (setup/poll)
    src/theme.rs          the web workspace's colours and type
    src/widgets.rs        buttons and fields, drawn like the web's
    src/avatar.rs         a bot's face and colour, computed as the web does
    src/icons.rs          the web workspace's icons (Lucide)
    src/view/             the screens, one module per region:
      sign_in.rs            address form and device code
      roster.rs             bots down the left edge
      header.rs             bot, conversation title, actions
      panel.rs              conversations: search, filter, rows
      conversation.rs       messages, replies, run status
      steps.rs              a run's tool steps and the approval bar
      composer.rs           the message box
      attachments.rs        one attached file as a card
      model_picker.rs       the composer's model button and its list
      inbox.rs              the inbox of notifications
      permissions.rs        the composer's command permissions
      welcome.rs            a new conversation
      settings/             Settings: shell, navigation, page parts,
                            Account, Appearance, bot pages
    src/sections.rs       the pages of Settings, named as the web names them
    src/notify.rs         hands an announcement to the system's notifications
    src/profile.rs        the Profile form's edits and saving rules, for
                          a saved bot and for one being created
    src/scenes.rs         synthetic states for snapshots and tests
    tests/screens.rs      headless element-tree checks, light and dark
  scripts/snapshots.sh    renders every scene to PNGs under target/snapshots
  scripts/bundle.sh       wraps the binary in target/bundle/Raphie.app (macOS)
  scripts/dmg.sh          packs the release app into target/dist/*.dmg
```

The crate split is the boundary for later work: the core owns the API client,
auth, event streams and state; the app only presents them. When the desktop app
becomes a _desktop host_ that offers this machine's capabilities to the runtime
(local speech-to-text, computer use, the owner's browser), those capabilities
belong in the core (or crates beside it), not in the UI. See
[learning Rust with this codebase](learning-rust.md) for a guided tour.

## Check your changes

```sh
cd apps/desktop
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

CI runs the same three commands in a separate `desktop` job beside `validate`.
On Linux, Rune needs `libxkbcommon-dev` and `libwayland-dev`, and the credential
store needs `libdbus-1-dev`.

Tests make no network calls beyond loopback and no model calls. The core's
tests run the real engine against a fake web host on a random loopback port; the
app's tests drive Rune's headless `Runtime` (same layout and input code as a
window, no GPU) through each screen in light and dark.

### Headless snapshots

Rune apps render without a window. Debug builds always accept the flags:

```sh
cargo build -p raphie-desktop
B=target/debug/raphie-desktop
$B --list-scenes
$B --snap out.png --scene approval --theme dark --size 1280x800 --scale 2 --chrome
$B --tree tree.json --scene conversation      # element tree as JSON
scripts/snapshots.sh                           # every scene, both themes, into target/snapshots (not committed)
```

Scenes are synthetic data from `app/src/scenes.rs`. Headless runs never start
the engine, touch the Keychain or open a connection. `--chrome` draws the
traffic lights where macOS puts them.

## Keeping the look in sync with the web

The desktop app copies the web workspace's design by value, so a change to the
web design must be made here too. Each file names its web source at the top:

| Desktop                     | Web source                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `app/src/theme.rs`          | `apps/web/src/shared/styles/tokens.css` (colours, shadows)                                   |
| `app/src/avatar.rs`         | `domains/settings/application/bot-glance.ts` and `bot-tone.ts`                               |
| `app/src/icons.rs`          | the Lucide icons the web components import                                                   |
| `app/src/sections.rs`       | `domains/settings/presentation/settings-sections.ts`, `settings-nav.tsx`                     |
| `app/src/profile.rs`        | the form state in `bot-profile-form.tsx`                                                     |
| `app/src/widgets.rs`        | `shared/ui/button.tsx`, `shared/ui/input.tsx`                                                |
| `core/src/projections.rs`   | `packages/contracts/src/sessions/projections.ts` (tool steps, usage, labels, number formats) |
| `core/src/model_library.rs` | `domains/settings/application/model-library.ts`, number formats in `model-card.tsx`          |
| `app/src/view/*.rs`         | the matching component and its rules in `chat.css`, `sessions.css` and `bot-workspace.css`   |

The web's root font size is 14 px, so its Tailwind sizes (in rem) are 14/16 of
their usual pixels: an `h-8` button is 28 pt here, `text-sm` is 12.25 pt.

Tests pin what can drift silently: `avatar.rs`, `projections.rs` and
`model_library.rs` check their
results against values printed by the web's TypeScript, and `tests/screens.rs` checks the page
and sidebar colours against the tokens in both appearances. To compare by eye,
render with `scripts/snapshots.sh` and put the PNGs beside the web workspace at
1280×800.

Where the two differ on purpose:

- Controls for features this app lacks are left out rather than shown dead:
  usage.
- The web's "conversations with updates" card over the composer is not
  here; the bell's count and the inbox cover it.
- System notifications are this client's own; the web has none. Clicking
  one has been checked on macOS; on Windows and Linux it is compiled in but
  not run.
- Attachments: the paperclip picks one file at a time (the web's picker
  takes several); drag several onto the conversation instead. Cards in the
  composer wrap onto new rows where the web scrolls them sideways. Pasting an image or
  copied files attaches them, which the web does not do.
- Account has no device list or passkeys. The web host answers those
  requests only for a signed-in browser, never for a device token
  ([Authentication](authentication.md#connect-a-native-device)), so the page
  links to the browser for them. Changing that is a decision about the web
  host's security, not about this app.
- The bar over a conversation shows the bot's name on one line, as on the
  web; the bot's description is its tooltip here. That bar and the one over
  a Settings page are 44 tall in both clients, level with the window's
  buttons in this one.
- Providers opens one connection form at a time; the web can have several
  open. That keeps at most one typed key in memory.
- Memory lists only the back ends that can be chosen (the web also shows
  the planned ones, greyed out). Unsaved Memory edits are dropped when you open another bot's
  Memory page, so a typed key is never kept off screen.
- Profile takes a custom colour as typed hex digits; the web opens the
  browser's colour picker.
- Revision history shows a revision's name, description and colour on one
  line above its personality; the web lays them out as labelled fields.
- Settings has no "UI plugins" page (this app has no plugins).
- The roster shows "N conversations need you" and the last message only for
  the selected bot, because the app follows one bot's sessions at a time.
- Sign-in asks for a Raphie address and shows a device code instead of a
  password form; it reuses the web sign-in card.
- A working run's label is plain text; the web's moves a shimmer across it.
- A message's sent time is its tooltip; the web fades it in beside the bubble.
- Numbered lists show their numbers.
- The "raphie" brand sits to the right of the macOS traffic lights, level
  with them.

## Keeping contracts in sync

`core/src/contracts.rs` mirrors only the fields this client reads from
`packages/contracts` (and the request bodies from the runtime's route handlers).
Unknown fields are ignored, and enums that may grow decode unknown values to
`Unknown`, so additive runtime changes do not break the app. Renaming or
removing a field the app reads must update that file in the same change.

Proposed follow-up (not built): generate these types from the TypeScript
definitions, for example by emitting JSON Schema from `@raphie/contracts` and
generating serde types with `typify`, with a CI check that the generated file is
current.

## Limits

- Built and checked on macOS (Apple silicon). The code builds for Windows and
  Linux (Rune supports both; the token store uses Credential Manager and the
  Secret Service), but they have not been run by hand.
- System notifications on macOS need the app bundle from
  `scripts/bundle.sh`; a bare `cargo run` posts none. The bundle is signed
  ad hoc. Notifications on Windows and Linux are compiled in but have not
  been run.
- Approvals given "for session" cannot be listed or revoked here (nor on
  the web).
- Tool steps come from the session's latest 200 journal entries, as on the
  web: turns older than that show their reply without steps or usage.
- The roster's and the panel's open state is not remembered between
  launches. The window is at least 960×560.
- Not signed with a Developer ID or notarised, so the first launch of a
  downloaded copy needs **Open Anyway**. No automatic updates: the update
  check only says a newer Raphie exists and links to its release page.
  Without an app bundle, macOS may ask to allow Keychain access the first
  time.
- No local runtime management: the app connects to a host that is already
  running.
- One message in flight at a time from the composer.
- Live acceptance against a real tailnet HTTPS origin has not been run; the
  live checks used the loopback fixture.

## Rune notes

Observations from building this app, recorded so the choice of Rune can be
judged on evidence. Rune rev `09ab92a5c83b906adb6fbf92637323b49e86d7ac` (`dev`,
"Declare the wasm32 target in rust-toolchain.toml (r420)").

What worked well:

- **Headless tooling is the real thing.** `--snap`, `--tree` and scenes rendered
  every screen without a window from the first build, and `rune::Runtime` let
  the UI tests click, paste and read the element tree with no GPU, so they run
  in CI. The PNGs in this guide come from `scripts/snapshots.sh`.
- **rune-kit got a first version on screen in hours:** `SplitView`/`Sidebar`,
  `TextArea` with Return-to-submit, `Button`, `Spinner` and a streaming-aware
  `Markdown` with syntax-coloured code, with no custom widget.
- **Porting the web design was direct.** Rune's element builders cover the CSS
  the web workspace uses: per-corner radii, layered box shadows, linear and
  radial gradients, hover and press overlays, keyboard-only focus rings, dashed
  borders, letter spacing and `text_case`. Its built-in sans is Inter, the
  web's font. Icons take SVG bodies, so Lucide's pasted in unchanged, and
  `Shape`/`Path` drew the bot faces from the same curves as the web's SVG. The
  redesign needed no workaround inside Rune.
- **`MarkdownStyle` has a setter for everything the web's `.markdown` rules
  set** (fonts, code block fill and border, link and inline-code colours, list
  indent), so the kit's `Markdown` stayed.
- **Background work fits cleanly.** `AppSpec::setup` hands over a `Waker`
  (`Arc<dyn Fn() + Send + Sync>`), which the UI-free core accepts as a plain
  callback, and `poll` drains its events. The core never depends on Rune.
- **The theme follows the OS** with `cx.system_dark()`; colours spring across
  on a live appearance change.
- Rune at this rev compiled and passed these tests on Rust 1.96 as well as the
  pinned 1.99.1.

Gaps and surprises:

1. **Toolchain pin.** Rune pins Rust 1.99.1 in its own `rust-toolchain.toml`,
   so this app pins the same. On a slow connection the first `rustup` download
   took over 30 minutes; the code itself also built on 1.96.
2. **Patches must be copied by hand.** A dependency's `[patch.crates-io]`
   does not apply to the app, so `apps/desktop/Cargo.toml` repeats Rune's four
   patches (winit, parley_engine, wgpu-hal, accesskit_windows) at the same rev.
   Forgetting one builds silently against stock crates. Recheck them on every
   Rune bump.
3. **Kit text fields default to a fixed 280 pt width** (Storybook parity).
   `TextInput`/`TextArea` need `.width(None)` to fill their container; the
   first snapshots showed a short composer.
4. **One key namespace.** rune-kit keys the parts of its components (`label`,
   `value`, `icon`, ...), so app keys share a namespace with them. This app
   prefixes its own with `rd-`.
5. **`AppSpec` takes `fn` pointers**, not closures, for `init`, `view`,
   `setup`, `poll` and `on_key`; configuration reaches them through
   `App::init`, `rune::extra_args()` or state, not captures.
6. **A covered window does not redraw** (documented). A `screencapture` of a
   covered window shows its last frame, which briefly looked like the app had
   ignored a revocation; the state had in fact changed.
7. **Debug-build launch warning:** "first frame took 2946 ms (setup 1895 ms)".
   The engine's start (Tokio runtime and TLS client) runs in `setup` before the
   first frame. Moving it later (Rune suggests `on_ready`) is a follow-up.
8. **Accessibility from scripts:** AppleScript/System Events saw only the
   window buttons, not the content tree, because AccessKit builds the tree only
   for an active assistive client. VoiceOver itself was not tried.
9. **The kit's look is its own design system.** Matching another design meant
   replacing the kit's shell, buttons and fields with about 250 lines of plain
   functions over Rune's elements (`app/src/widgets.rs`), and keeping only
   `Markdown` and `Loader`. `TextInput` has a borderless `plain()` mode for
   this; `TextArea` does not, so the composer uses `rune::text_input` with
   `auto_grow` directly.
10. **A border takes no layout room by default**, so a child with its own fill
    draws over its parent's border (the sign-in card's tinted top hid the card
    edge). `border_layout()` makes it behave like a CSS border.
11. **`clip_rounded` clips the element's own drop shadow too.** Clipping the
    card to round its children's corners removed the card's shadow; clipping
    the inner section instead kept it.
12. **Text defaults to a 1.25 line height**, the web to 1.5. Rows only came out
    the web's height after setting line heights explicitly (`theme::font`).
13. **`Cx::titlebar_inset` is horizontal** (how far the traffic lights reach in
    from the left), and headless runs report it too, so `--chrome` snapshots
    lay out exactly like a window.
14. **A large, faint radial gradient showed slight rings** in a 1x window
    capture of the sign-in page. Not investigated.
15. **No Rune bugs** were hit: every problem above was a default, a documented
    behaviour or a toolchain cost.

Since the redesign: `Tx::wake_after` from `poll` gave the once-a-second tick
for "12s elapsed" with no timer thread, and `icon_rotation` turns the unfold
chevron. Text filled with a moving gradient (the web's shimmer on a working
label) was not found and not ported.

For Settings → Models the kit's `Select` came back in: restyling was not
needed, since a `Kit` built from the web's colours already draws a drop-down
that sits well beside the app's own controls. Its list floats above the page
through `rune_kit::root`, which the view root now wraps everything in.

Not used yet: `Cx::layout_with` reads an element's size from the last layout
and re-runs the view only when a breakpoint is crossed. It is the way to narrow
the side panels with the window, as the web workspace does.
