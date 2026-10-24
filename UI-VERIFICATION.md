# UI verification — 2026-10-20

Continued the interrupted theme/contrast audit. This work ran locally on the Mac; no SSH, VM changes, or paid model calls were made.

## Changes in this continuation

- Aligned Tailwind's `dark:` variant with `data-theme`, falling back to the system theme when no explicit choice is set.
- Increased the contrast of the faint text token in both themes, including conversation times, reply metadata, and composer hints.
- Set the send button to 32 CSS pixels. The existing `size-8` was 28px because the app uses a 14px root font size.
- Retained the previous CSS layering fix. The reported dark-mode icon failure did not reproduce against the current source; sidebar, activity, approval, and send icons were inspected in both themes.

## Verification

- `npm run check`: passed for web and runtime.
- `npm test`: 5 web and 22 runtime tests passed. The initial sandboxed invocation had six runtime failures caused by `listen EPERM`; rerunning with loopback access passed all tests.
- `npm run build`: passed, including the final CSS. Vite still reports a client chunk over 500 kB.
- Browser acceptance used `packages/runtime/test/browser-fixture.ts`, with a temporary database and deterministic model/MCP responses. No existing conversations were altered by the acceptance run.
- Checked layouts at 320, 768, 1024, and 1440 CSS pixels; document width matched viewport width. Visually inspected mobile and desktop views.
- Checked both themes, sidebar navigation, Escape dismissal, keyboard focus reaching the composer, a normal reply, and the fake calendar tool's approval/result flow.
- Sampled final timestamp and secondary-text contrast exceeded 4.5:1; sampled active icons exceeded 3:1. This was a focused computed-style check, not a complete accessibility certification.
- Confirmed the send button measures 32 × 32px and the textarea stays transparent in explicit dark mode.

The test fixture and Vite server were stopped normally. The normal production app was then restarted with `npm start`, using the existing Varlock configuration. No secrets were read or edited. Existing unrelated working-tree changes were preserved.

## Session URLs, errors, and sidebar follow-up

- Diagnosed the screenshots: `acceptance` is the temporary fixture model, whose database was removed on shutdown. The normal runtime still had one session with three turns; a separate archived gateway database also remains. The earlier test used the normal ports, making this distinction confusing.
- Moved fixture defaults to runtime port 4317 and UI port 4321, with dedicated npm scripts. Normal ports remain 4316/4320.
- Added persisted UUIDv7 public IDs and `/sessions/$sessionId` routes. Legacy numeric links redirect after loading the current database. Internal Pi conversation IDs remain intact. Added a regression test that removes a public ID to simulate legacy data, reopens twice, and verifies both stable migration and preserved history.
- Anchored relative `DATA_DIRECTORY` paths to the repository root.
- Added centered missing-session and runtime-connection cards with icons and actions. Missing sessions no longer display the welcome screen and composer.
- Removed the sidebar approval summary; session cards show a preview, last activity, message count, and labeled Approval/Working/Error/Ready badge.
- Saved a consistent pre-migration SQLite backup to `.data/backups/before-session-ids-20261020.sqlite`. The archived database was only inspected read-only.
- Verified fixture creation redirects to a UUIDv7 URL, legacy links redirect, the missing-session card hides the composer, and approval badges appear without a sidebar banner. Full suite: 5 web and 23 runtime tests passed.
- Verified the connection failure card after stopping only the isolated fixture, and checked the missing-session card and sidebar at 320px in dark mode without horizontal overflow.
- Final type check, production build, and whitespace check passed. Restarted the normal app and confirmed its existing session opens via the legacy URL, redirects to its saved UUIDv7 URL, and loads directly after navigation. Its history remains present. The isolated fixture and its UI were stopped.
- Restart encountered listeners left behind by the existing launcher; inspected their PID/command/cwd and stopped only the two confirmed Raphie processes before starting the updated app. No unrelated processes were stopped.
- The final production check reproduced a separate live-stream bug as history grew: `res.write(false)` was treated as failure and destroyed the SSE connection. A large synthetic history regression test failed with `TypeError: terminated` before the fix. The server now waits for the socket buffer to drain before sending another snapshot, keeping large histories connected. The full suite then passed: 5 web and 24 runtime tests, plus type checks. Runtime was restarted to load this fix.

## Activity visibility, panel sizing, and switch alignment

- Pending activity previously rendered under the user message, above the assistant output, and could disappear once text started streaming. It now remains below the latest output until the turn settles, with observed model/tool/retry/approval phase and an elapsed timer. These labels describe observable activity, not private model reasoning. Added a regression test covering the transition from an intermediate response to tool execution and the next model wait.
- Constrained the navigation grid to `minmax(0, 1fr)` and its cards to the available width. Verified a long title and preview no longer enlarge or clip the list. Removed the idle Ready badge.
- Added pointer and keyboard resize handles for navigation and activity, saved independently in browser preferences. Double-click resets widths. Effective widths adapt to keep at least 320px for chat when panels are docked. Verified pointer dragging, keyboard increments, reload persistence, and a 1200px window with 480px navigation, 400px activity, and 320px chat.
- Fixed the plugin switch's collapsing pseudo-element margin by positioning the 16px thumb absolutely, 2px from the top/edge of its 36 × 20px track. Verified matching label/track geometry and thumb position in both checked and unchecked states.
- Verification: 6 web and 24 runtime tests passed; type checks, production build, and whitespace check passed. Isolated fixture stopped normally. Updated the production UI. The existing launcher also stopped the runtime when the old web process exited, so restarted the runtime immediately and verified recovery with no pending turns or uncertain actions. Real session data remains in place.

## Settings — 2026-10-21

- Backend address selection tests the target before saving a browser cookie scoped
  to the web port. Development and production use the same API/SSE proxy.
- Models offers an OpenRouter provider connection with password input, key testing,
  saving/replacing/removing a key, disconnecting, catalog search and default model.
  Backend credentials remain out of read responses; the input clears after saving.
- Telemetry persists per backend and suppresses new traces immediately. Against the
  isolated fixture, repeated requests left the span count unchanged while disabled;
  re-enabling resumed collection. Retained traces and Activity are preserved.
- Browser acceptance used ports 4317/4321 and temporary SQLite with a deterministic
  provider, no real keys or paid inference. The selected alternate fixture model
  became the runtime default and completed a new turn. Connection testing/saving,
  mobile navigation, and switch interactions passed. Settings remained accessible
  after stopping the fixture backend.
- Computed layout checks at 320/768/1024/1440px found no horizontal overflow; inputs,
  selectors and buttons stayed within the 320px viewport. Both theme text colors
  and switch visibility were checked. Screenshot capture failed twice with
  `Preview automation snapshot timed out after 15000ms`; the alternate CUA browser
  was unavailable, so this is DOM/interaction acceptance, not screenshot review.
- The full validation gate passes 61 tests plus formatting, lint, architecture,
  TypeScript and production build. Existing large-chunk build warning remains.

## Composer models and consistent controls — 2026-10-21

- Original model-picker implementation using shared shadcn-style Button, Input,
  Select and Popover primitives; T3 screenshots served only as visual references.
  No T3 code was reused. Settings inputs, selects and switches now use shared
  primitives; native browser dropdown styling is replaced by the Radix menu.
- New-session selections persist with admission. Existing-session changes save
  immediately while idle. Defaults remain in Settings and affect new sessions.
  Backend regression tests cover actual dispatch, migration, reopen, retry
  fingerprints, unavailable models and busy rejection.
- Browser acceptance used temporary fixture data and deterministic inference at
  4317/4321. Checked choosing before first send, saved selection, busy disabling,
  keyboard search/ArrowDown/Enter selection, Escape/focus restoration, favorites,
  no-match results, Settings navigation and a 102-model scrollable catalog.
- Computed picker bounds stayed within 320/768/1024/1440px viewports for the short
  catalog. The long catalog stayed capped at 440px with its own Radix scroll
  viewport and responded to scrolling. Family filtering and text search combined
  to find a specific model in that catalog.
- After the focus-state correction, the auto-focused search input reports no
  outline or visible ring; the provider trigger reports no outline and renders a
  Radix listbox. The resizer reports no outer outline and retains its thin line
  indicator for keyboard focus. Screenshot capture still timed out, and no
  alternative browser tool was available. These are interaction/layout checks.
- `bun run validate` passes 64 tests, formatting, lint, architecture, TypeScript
  and production build. The existing large client-chunk warning remains.
- Work is published through separate PRs targeting main; no PR was merged or
  production session modified during acceptance.

## Base UI migration — 2026-10-22

- All shared interactive primitives now use `@base-ui/react`: Button, Input,
  Popover, Select, Separator, Switch, Tooltip, ScrollArea and the sidebar sheet.
  Badge composition uses Base UI `useRender`; Textarea remains native HTML,
  matching shadcn's implementation. Removed the Radix package and its transitive
  dependencies from the lockfile. The Radix references above describe historical
  verification, before this migration.
- Browser checks used the disposable long-history and 102-model fixture on
  ports 14317/14321. Checked nested family selection without dismissing the
  model picker, selected labels, search and arrow-key wrapping with 102/2/1/0
  results, Escape/focus restoration, Settings Back with draft preservation,
  tooltips, and switch state/keyboard operation.
- Transcript and multiline composer scrolling retain their single viewport;
  the browser layout probe reports zero competing native scrollers and a
  floating composer at desktop and mobile widths.
- The full validation gate passes 96 tests, formatting, architecture, lint,
  types and production build. A dependency boundary rule prevents new web
  imports from Radix packages. Memory remains separate from this PR to main.

## Bot identity and personality — 2026-10-23

- Used a disposable runtime/web fixture on 14317/14321 with deterministic models
  and synthetic provider keys. Normal application data and services were untouched.
- Created a named bot through Settings → Bot, edited SOUL.md, saved revision 2,
  reloaded and verified the text and history. The default bot's personality stayed
  unchanged. A new bot had no inherited provider connection.
- Configured that bot's provider through its own Providers page, switched between
  it and the default bot, and verified that unsent drafts stayed separate.
- Sent a named-bot message and reloaded its UUID session URL with the bot query
  parameter. The correct bot and transcript were restored without resubmission.
- Checked 320, 390, 768 and 1440px layouts without horizontal page overflow,
  light/dark form rendering, keyboard field order, and keyboard operation of the
  bot selector. No browser exceptions occurred. The first preview snapshots timed
  out twice; acceptance used temporary Playwright tooling outside the repository.
- Fixed two lifecycle problems found by the browser flow: effect replay could
  retire a scope that was reused, and route navigation could repeat backend
  initialization. Scope state now follows the actual backend instance; initial
  backend lookup is independent of navigation and ignores obsolete completions.

## Bot-first workspace and settings — 2026-10-24

- Applied the approved bot roster, per-bot conversation library, unified title bar
  with an icon-only new-conversation action, and collapsible grouped reply card.
  The existing Composer component and floating composer CSS remain unchanged.
- Settings keep the bot roster visible. Profile, personality, provider/model,
  memory and diagnostics pages are scoped to the selected bot. App-wide backend,
  appearance and UI-plugin preferences have a separate navigation group. Mobile
  uses a compact settings section picker.
- Used disposable fixture ports 14317/14321, deterministic inference and temporary
  browser tooling outside the repository. Collaborative-browser interaction
  checks covered personality revision saves, unsaved-route blocking and bot
  creation. Screenshot capture failed twice with `Preview automation snapshot
timed out after 15000ms`, so visual acceptance continued with Playwright.
- Browser acceptance verified a completed reply arriving while the card stayed
  collapsed, read and dismiss behavior, library unread filtering, collapse
  persistence after reload, per-conversation draft restoration, personality
  save/reload, independent bot personalities, app/bot scope labels and diagnostics
  navigation. Checked 320/390/768/1024/1440px without page overflow, both themes,
  keyboard focus on the new icon action and long conversation titles. No browser
  exceptions occurred.
- Visual inspection found a mobile button competing with the bot roster and a
  short personality editor caused by utility precedence. The mobile action now
  uses a plus icon in the roster; the editor has explicit utility minimum sizes.
- Unit coverage verifies scoped, monotonic reply cursors and concurrent-tab
  merges. Runtime query coverage verifies pending user turns do not count as
  replies, and session-list/detail reply counts agree.
- Full validation passes 117 tests, formatting, architecture, lint, types and the
  production build. The existing large client-chunk warning remains. Application
  data and the normal runtime were not changed during fixture acceptance.

## Full-window grouped settings — 2026-10-24

- Replaced the roster-plus-settings-column layout with a full-window settings
  screen built on the shadcn `Sidebar` (`sheet`, `skeleton` and `collapsible`
  added through the shadcn CLI; existing button, input, separator and tooltip
  kept). Each bot is an expandable group; Backend connection, Appearance and UI
  plugins sit in a separate App group. The chat roster's settings entry is now a
  gear icon beside the connection status.
- Section ids and links are unchanged; revision history and memory browsing
  highlight Personality and Memory. Expanded groups persist in browser storage
  so they survive the remount when selecting another bot's page.
- Playwright on fixture ports 14317/14321 verified: expanding or collapsing
  groups keeps the URL and an unsaved personality draft; selecting another
  bot's page is blocked until discard, then switches bot and section; both
  groups stay open after the switch; `section=memory-browse` and legacy
  `view=plugins` links; close returns to chat; Create a bot; mobile sheet opens
  from the title-bar trigger, closes on Escape with focus back on the trigger,
  and closes after choosing a page. Sub-items fill the row. A top-bar toggle and
  ⌘B collapse the desktop sidebar, sharing the chat sidebar's saved state.
  Chat and settings share one shadcn `SidebarProvider`/`Sidebar`/`SidebarInset`
  shell; only the sidebar content changes, so width, collapse and ⌘B live in
  one place. The resize handle drives `--sidebar-width` with width transitions
  disabled, so the sidebar edge tracks the handle on the same frame. Mobile chat
  keeps the accepted bot strip; mobile settings use the shadcn sheet.
- Re-ran the earlier chat suite (reply card, drafts, collapse persistence,
  library, mobile) on a reset fixture and ported its settings steps: guarded
  save, revision reload, per-bot personality isolation, app scope, layout widths
  and draft restoration after leaving settings. Checked 320/390/768/1024/1440px without
  overflow in both themes at 2x; no browser exceptions.
- Full validation passes 117 tests, formatting, architecture, lint, types and the
  production build.
- Settings → Diagnostics shows recent traces under the collection toggle; the
  separate Diagnostics view and its "Open diagnostics" button are gone, and old
  `?view=diagnostics` links open this page. Named bots still read their own
  empty trace model, never another bot's traces.

## Settings page design pass — 2026-10-24

- Every settings page shares a `SettingsPage` header: the scope chip, the title
  and a page-specific intro from the section registry (`settings-sections.ts`).
  Bot pages wash in that bot's avatar colour (`--tone`, shared with avatars), so
  scope is visible before any field; app pages use the accent green.
- Shared building blocks: `Group` (with an optional action), `Row` (optional
  icon tile), `SettingsStatus` for loading/error, and a floating `SaveBar` that
  appears only with unsaved changes, pending saves or messages.
- Personality history is a timeline; Appearance previews each theme; Providers
  and Models no longer repeat the page title. Appearance, plugins, memory
  browsing, Hindsight fields, memory capabilities and the settings top bar are
  separate modules, and settings CSS is split per page under `styles/settings/`.
- Checked every settings page in dark and light, a named bot at 1440 and 390px,
  save-bar visibility (clean, dirty, discard, create) and the existing settings,
  diagnostics, resize and chat flows; no overflow from 320px and no browser
  exceptions. Full validation passes.
- Bot avatars use the chosen "Glance" design: each bot's blob shape and eye
  direction derive from its id (integer PRNG, so every browser draws the same
  face) and its colour family. Checked in the chat roster, title bar, settings
  sidebar, scope chip and mobile strip in both themes.
- Bot switches keep the backend-wide bot roster and inbox summaries cached,
  while replacing bot-scoped queries and editors. Frame sampling across Research,
  Builder and Raphie found all four roster entries present in every frame and no
  intermediate "Loading bot…" screen. Full validation passes all 118 tests.
- Settings breadcrumbs now show the bot avatar/scope and the current page icon.
  The grouped reply card uses a neutral surface, with distinct reply/approval
  icons; collapse, dismissal and unread behavior are preserved.
- The conversation library has counted filters, a scoped header, unread badges
  inside each conversation, and a search empty state. Clearing search restores
  input focus. Compact filter labels fit narrow windows.
- Verified these refinements in both themes, including 2× zoom, and checked
  320/390/768/1024/1440px layouts. Search, unread filtering, keyboard collapse,
  mobile navigation focus restoration and the unsaved-edit guard pass in the
  collaborative browser with no console errors. All 118 tests and production
  build pass; the existing large-chunk build warning remains.
- Bot navigation uses avatar-tinted tiles, a selected surface with a full outline,
  and a compact connection footer. Selection must never use a colored left
  border or stripe; the conversation library follows the same rule.
- The settings toggle uses directional chevrons on desktop and a menu icon on
  mobile, retaining shadcn's navigation and focus restoration. Checked search
  and its empty state, desktop open/close icons, and mobile Escape focus restore.
- The roster brand uses the same Glance avatar as the bots. The connection
  footer has no border or background.
- Activity docks at full height beside the conversation from 768px, matching
  the navigation breakpoint; it no longer floats over chat below 1100px.
  Mobile uses the shared Sheet with focus trapping, Escape/close, and focus
  restoration. Verified docking geometry at 768/1024px, mobile open/close and
  focus restoration at 390px, plus light/dark visual checks. Full validation
  passes all 118 tests.
- Chat and settings share the directional navigation-toggle icons and styling.
  The welcome screen shows the selected bot's Glance avatar, matching its header
  avatar. Checked toggle direction, avatar identity, both themes and mobile;
  full validation passes all 118 tests.
- Generic settings entry points (sidebar gear and bot header) always open the
  current bot's Profile. Both preserve the active conversation route, so closing
  settings returns to the same conversation. Explicit links to Models or other
  sections keep their destinations. Verified both entry points and a named bot.
- Settings sidebar and app-wide scope chips now use the Glance brand avatar.
  The roster brand has an optical alignment correction: the drawn avatar and
  lettering centers differ by less than 0.25 CSS pixels in the checked font.

# Per-bot MCP and scheduled prompts — 2026-10-24

- Disposable browser runtime on 14327 and UI on 14331; synthetic MCP server on 14328. No normal application data or external inference was used.
- MCP connection creation, pause/enable and multiple connections succeed. Another
  bot opens with an empty inventory and explicit scope in its settings header.
- Job creation, Run now, pause/resume and result-conversation admission succeed.
  Unsaved job drafts block navigation until discard; interval and time edits also
  participate in the guard. MCP drafts and transport changes use the same guard.
- The two new forms fit at 320, 390 and 1440px without horizontal page overflow;
  light and dark appearance and the mobile settings sheet were inspected.
- Automated tests cover encrypted MCP configuration, isolated APIs, Pi tool-search
  availability without memory, delayed startup/restart recovery and shared job
  conversations. `bun run validate` passes 121 tests, architecture checks, lint,
  types, formatting and production builds. The existing large-chunk warning remains.

# Backend restart recovery — 2026-10-24

- Reproduced a terminal EventSource failure: an HTTP 503 during a restart closes
  the browser's stream permanently, leaving the UI showing “Reconnecting…”.
- Closed streams now reconnect with backoff from 1 to 15 seconds. Native retries
  continue for streams that are still reconnecting. Leaving a session or retiring
  its backend cancels pending retries and ignores queued events from old streams.
- Transient session-fetch errors no longer prevent the session stream from
  recovering; missing sessions still retain their 404 handling.
- Verified an actual dev-backend restart with Chromium: the open conversation
  recovered without a reload, its draft and document survived, and no POST commands
  were replayed. A second page opened during the outage also recovered by itself.
  The regression test covers closed-stream replacement, native retry ownership,
  scoped URLs, queued events and retry cancellation.
