# Scroll ownership and floating composer

Fixed 2026-10-21. The transcript previously combined an `overflow-y: auto` wrapper
with `StickToBottom.Content`, which creates its own native scrolling element and
stable gutters. The composer occupied a separate flex row, so messages could not
scroll underneath it. The activity, settings and session lists used unrelated
native scroll containers too.

The shared shadcn-style ScrollArea uses the existing `radix-ui` dependency; no
package was added. Panel ancestors constrain size without scrolling. Radix owns
the viewport and custom thumb. The transcript's `useStickToBottom` refs point
directly at this viewport and its content, preserving streaming follow behavior,
reading-position escape and the jump-to-latest control. Code blocks, tables,
bounded approval/activity details, settings, session navigation and multiline
drafts use the same primitive.

The composer floats inside the chat stage. A ResizeObserver publishes its actual
height as a local CSS variable. Transcript padding and the jump button use that
height, so the last message remains reachable above the card as drafts, errors
and toolbars grow. The textarea grows inside a capped ScrollArea; caret measurement
keeps typing and edits within the visible draft region without a second scrollbar.

## Reproduce and verify

Run only the disposable fixture on ports 4317/4321:

```sh
RAPHIE_FIXTURE_LONG_HISTORY=true bun run --parallel dev:fixture dev:web:fixture
```

Open its saved fixture session. It contains 60 synthetic long replies, wide code,
tables and detailed activity records. The database is temporary and removed on
normal shutdown. It does not copy production messages or call a remote model.

`scripts/check-scroll-layout.browser.js` exports a browser-context probe. Execute
its function in the collaborative browser after loading the session (the agent
can read the file, strip its module export and evaluate it there). It throws if
an overflowing native container reappears, the transcript stops above the composer,
or the page overflows horizontally. This checks live layout, rather than matching
CSS implementation text in a unit test.

Acceptance verified on the rendered app:

- 320, 768, 1024 and 1440 CSS-pixel layouts: no page overflow, no competing native
  scrollers; floating composer stays within bounds.
- One transcript viewport, with wide code/table scrolling confined to its content.
- Activity payloads remain capped at 280 pixels and use custom scrollbars.
- A 25-line draft uses a capped custom viewport; editing its beginning reveals
  that caret and typing at its end reveals the final lines.
- Reading older messages during a deterministic streamed reply preserves scroll
  position; jump-to-latest reaches the bottom and leaves the last reply above
  the composer.
- Light/dark themes, mobile navigation and settings retain the shared scroll path.

The full `bun run validate` gate passes (48 tests, formatting, lint, architecture,
TypeScript 7 and build). Browser layout is verified with the fixture/probe; the
Bun suite does not claim browser geometry coverage.
