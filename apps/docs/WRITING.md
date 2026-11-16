# Writing Raphie's docs

The site in `apps/docs` is the only home of Raphie's documentation. Pages live
in `src/content/docs/<section>/<page>.mdx`; the sidebar is generated from those
folders. `CONTRIBUTING.md` and `CONTEXT.md` stay at the repository root and are
rendered into the Contribute section at build time, so edit them there.

## What a page is for

Each page answers one question a reader actually has: "how do I install this",
"what can a bot's sandbox reach", "how do I recover a lost admin password".
If a page answers several, split it. If two pages answer the same one, merge
them.

Document what Raphie does today. Planned work does not go in guides; if a limit
matters, state the limit ("Telegram can't send files yet"), not the plan.

## Voice

- Lead with the answer, then the detail. The first paragraph after the lede
  should let a hurried reader stop there.
- Short sentences, plain words, second person ("you"), active voice.
- One idea per paragraph; three or four sentences at most.
- No history ("previously", "slice 2", "now implemented"), no internal ticket
  or slice names, no hedging filler ("note that", "it is important to").
- Use the terms in the glossary exactly: a bot is not a session, a bot's
  workspace is not the web workspace, a turn is not a message.

## Shape

Every page has this frontmatter:

```mdx
---
title: Memory # short, noun phrase, sentence case
description: One sentence saying what the reader gets from this page. # shown as the lede
sidebar:
  order: 3 # position within its section
---
```

Do not repeat the title as a `#` heading; the page header renders it.

Then:

1. An opening paragraph (two or three sentences) with the answer.
2. `##` sections in the order a reader needs them: do it, then understand it,
   then limits and recovery.
3. Prefer structure to prose:
   - **Steps** (`<Steps>`) for procedures.
   - **Tables** for settings, defaults, commands, limits, comparisons.
   - **Tabs** (`<Tabs>`/`<TabItem>`) for alternatives such as macOS vs Linux.
   - **Asides** (`:::note`, `:::tip`, `:::caution`, `:::danger`) for the one
     thing a reader must not miss; at most two or three per page.
   - **Diagrams** (see below) whenever a flow, sequence, state change or
     topology is being described.
4. End with a short "Related" list of links only when it helps.

Import components at the top of MDX files:

```mdx
import {
  Badge,
  Card,
  CardGrid,
  FileTree,
  LinkCard,
  Steps,
  TabItem,
  Tabs,
} from "@astrojs/starlight/components";
```

## Diagrams

Diagrams are HTML components, not images or Mermaid, so their text stays at
reading size, they reflow on phones and they follow the light and dark theme.
Import them from `~/components/diagram`:

```mdx
import { Arrow, Box, Flow, Row, Sequence } from "~/components/diagram";
```

**`Flow`** draws layers top to bottom. A `Row` holds boxes side by side (they
wrap on narrow screens); give it a `label` to draw a boundary such as a
process, a machine or a bot, and `accent` to highlight it. An `Arrow` between
rows connects them, with an optional `label` for what crosses. `Arrow right`
sits between boxes inside a row.

```mdx
<Flow>
  <Box title="You" tone="person" />
  <Arrow label="HTTPS" />
  <Row label="Your machine" accent>
    <Box title="Web host">sign-in · UI</Box>
    <Arrow right label="/api" />
    <Box title="Runtime" tone="accent">
      sessions · turns
    </Box>
  </Row>
  <Arrow />
  <Box title="Data directory" tone="store" />
</Flow>
```

`Box` takes a `title` and an optional line of detail as its content. Tones:
`accent` (the subject of the diagram), `attention` (where the owner acts),
`store` (persistent data), `person` (a human) and `muted` (something outside
Raphie). `Arrow` also takes `dashed` (optional, asynchronous or a reply) and
`both`.

**`Sequence`** draws messages between actors over time. Each step is an
array `[from, to, label]`, with `"reply"` as a fourth item for a dashed reply.
A step from an actor to itself is something that actor does alone.
`{ note: "..." }` spans every actor; `{ group: "...", steps: [...] }` frames a
loop or a condition and can nest once.

```mdx
<Sequence
  actors={["Owner", "Runtime", "Model"]}
  steps={[
    ["Owner", "Runtime", "Send a message"],
    ["Runtime", "Runtime", "Admit the turn"],
    ["Runtime", "Owner", "Receipt", "reply"],
    {
      group: "Until no tool call",
      steps: [["Runtime", "Model", "Prompt and tools"]],
    },
  ]}
/>
```

Keep a diagram to what one glance can hold: about ten boxes, or five actors
and a dozen steps. Split bigger ones. Both take an optional `caption`.

## Links

- Link between pages with root-relative URLs: `[memory](/guides/memory/)`,
  `[limits](/guides/memory/#limits)`.
- Everything a reader needs is on the site. Link outside it only for
  third-party tools (BotFather, Tailscale, a model provider's key page).
  Source files are fine to name in backticks; do not link to GitHub for docs.

## Accuracy

Docs describe the code, so check defaults, paths, ports, commands, flags and
limits against the source before writing them down. When behaviour, defaults,
settings, storage or API contracts change, update the matching page in the
same change.

## Verify

```sh
bun run --filter @raphie/docs build   # builds and checks every page
bun run --filter @raphie/docs dev     # http://127.0.0.1:4330
```
