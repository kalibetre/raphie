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
