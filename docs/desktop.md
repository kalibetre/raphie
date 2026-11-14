# Desktop client

Raphie Desktop is a native app for the daily loop: sign in, pick a bot and a
conversation, read and send messages with replies streaming in, and approve or
reject tool actions. It is written in Rust with [Rune](https://github.com/anomalyco/rune),
a GPU-rendered UI framework, and lives in `apps/desktop`.

It is a **client of the web host's authenticated API**, the same API the web
workspace uses. It never talks to the runtime's port 4316, so it works the same
whether Raphie runs on this machine or on a server reached over a tailnet.

It looks like the web workspace on purpose: the same colours, type, bot faces,
icons and layout, in light and dark.

![Approval, light](images/desktop/approval-light.png)

|                                | Light                                             | Dark                                             |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------ |
| Sign in                        | ![](images/desktop/sign-in-light.png)             | ![](images/desktop/device-code-dark.png)         |
| New conversation, panel open   | ![](images/desktop/conversations-light.png)       | ![](images/desktop/conversations-dark.png)       |
| Conversation                   | ![](images/desktop/conversation-light.png)        | ![](images/desktop/conversation-dark.png)        |
| Reply streaming in             | ![](images/desktop/streaming-light.png)           | ![](images/desktop/streaming-dark.png)           |
| Tools a run used               | ![](images/desktop/tools-light.png)               | ![](images/desktop/tools-dark.png)               |
| Working, with a queued message | ![](images/desktop/working-light.png)             | ![](images/desktop/working-dark.png)             |
| Settings: Account              | ![](images/desktop/settings-account-light.png)    | ![](images/desktop/settings-account-dark.png)    |
| Settings: Appearance           | ![](images/desktop/settings-appearance-light.png) | ![](images/desktop/settings-appearance-dark.png) |

## What works

Delivered in this first version (macOS first; see [Limits](#limits)):

- **Device sign-in** against any configured origin, using the flow in
  [Connect a native device](authentication.md#connect-a-native-device). The app
  shows the code and the approval link, polls at the host's interval (never
  faster than every 5 seconds, slower when asked), and refuses an approval link
  that points at a different origin.
- **Token storage** in the OS credential store: the login Keychain on macOS
  (service `dev.raphie.desktop`, one entry per origin). The token is never
  written to a file or a log. At launch the app reuses a stored token for the
  last origin; if the host answers 401 (the device was disconnected in
  Settings → Account, or the password was recovered), the token is deleted and
  the app returns to sign-in with an explanation.
- **Bots and conversations** from the focused client queries: the bot roster
  (`GET /api/bots`), each bot's live session list (`/api/sessions/events`, plus
  "Load more conversations" pages), and bot-prefixed routes for named bots. The
  conversations panel (the button at the top right) searches titles and
  filters to conversations that need an approval. ⌘B hides the roster.
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
  - **A bot's pages** (Profile, Providers, Models, ...) are not built yet:
    each offers the same page of the web workspace in your browser.
- **Light and dark** follow the OS appearance, live, unless Appearance pins
  one.

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
    src/engine.rs         Tokio runtime: sign-in, streams, commands → events
    src/settings.rs       last origin (non-secret)
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
      welcome.rs            a new conversation
      settings/             Settings: shell, navigation, page parts,
                            Account, Appearance, bot pages
    src/sections.rs       the pages of Settings, named as the web names them
    src/scenes.rs         synthetic states for snapshots and tests
    tests/screens.rs      headless element-tree checks, light and dark
  scripts/snapshots.sh    renders the PNGs in docs/images/desktop
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
scripts/snapshots.sh                           # every scene, both themes, into docs/images/desktop
```

Scenes are synthetic data from `app/src/scenes.rs`. Headless runs never start
the engine, touch the Keychain or open a connection. `--chrome` draws the
traffic lights where macOS puts them.

## Keeping the look in sync with the web

The desktop app copies the web workspace's design by value, so a change to the
web design must be made here too. Each file names its web source at the top:

| Desktop                   | Web source                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `app/src/theme.rs`        | `apps/web/src/shared/styles/tokens.css` (colours, shadows)                                   |
| `app/src/avatar.rs`       | `domains/settings/application/bot-glance.ts` and `bot-tone.ts`                               |
| `app/src/icons.rs`        | the Lucide icons the web components import                                                   |
| `app/src/sections.rs`     | `domains/settings/presentation/settings-sections.ts`, `settings-nav.tsx`                     |
| `app/src/widgets.rs`      | `shared/ui/button.tsx`, `shared/ui/input.tsx`                                                |
| `core/src/projections.rs` | `packages/contracts/src/sessions/projections.ts` (tool steps, usage, labels, number formats) |
| `app/src/view/*.rs`       | the matching component and its rules in `chat.css`, `sessions.css` and `bot-workspace.css`   |

The web's root font size is 14 px, so its Tailwind sizes (in rem) are 14/16 of
their usual pixels: an `h-8` button is 28 pt here, `text-sm` is 12.25 pt.

Tests pin what can drift silently: `avatar.rs` and `projections.rs` check their
results against values printed by the web's TypeScript, and `tests/screens.rs` checks the page
and sidebar colours against the tokens in both appearances. To compare by eye,
render with `scripts/snapshots.sh` and put the PNGs beside the web workspace at
1280×800.

Where the two differ on purpose:

- Controls for features this app lacks are left out rather than shown dead:
  attachments, the model picker, command-permission mode, usage, notifications,
  New bot, and the "New replies" filter (there is no read tracking).
- Account has no device list or passkeys. The web host answers those
  requests only for a signed-in browser, never for a device token
  ([Authentication](authentication.md#connect-a-native-device)), so the page
  links to the browser for them. Changing that is a decision about the web
  host's security, not about this app.
- Settings has no "UI plugins" page (this app has no plugins) and no "Create a
  bot" yet.
- The roster shows "N conversations need you" and the last message only for
  the selected bot, because the app follows one bot's sessions at a time.
- Sign-in asks for a Raphie address and shows a device code instead of a
  password form; it reuses the web sign-in card.
- A working run's label is plain text; the web's moves a shimmer across it.
- A message's sent time is its tooltip; the web fades it in beside the bubble.
- Numbered lists show their numbers.
- The "raphie" brand sits level with the macOS traffic lights, to their right,
  with less space above and below it than on the web, like a compact title bar.

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
- No attachments, model picker, command-permission mode, grant list,
  notifications or unread markers, and a bot's settings pages are not native
  yet. Use the web workspace for those (each bot page links to it).
- Tool steps come from the session's latest 200 journal entries, as on the
  web: turns older than that show their reply without steps or usage.
- The roster and panel have fixed widths (264 and 340 pt) and their open state
  is not remembered between launches. The window is at least 960×560.
- No packaging, signing or auto-update: run it from a checkout. Without an app
  bundle, macOS may ask to allow Keychain access the first time.
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

Not used yet: `Cx::layout_with` reads an element's size from the last layout
and re-runs the view only when a breakpoint is crossed. It is the way to narrow
the side panels with the window, as the web workspace does.
