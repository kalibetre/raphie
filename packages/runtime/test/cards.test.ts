import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import {
  buildCard,
  type CardInput,
  MAX_CARD_ITEMS,
} from "../src/domains/cards/domain/card.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 300; n++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Expected state did not settle.");
}

function built(input: CardInput) {
  const result = buildCard(input);
  if ("error" in result) throw new Error(result.error);
  return result;
}

const at = (value: string) => Date.parse(value);

const tickets: CardInput = {
  title: "AF board · open",
  url: "https://example.atlassian.net/boards/7",
  source: "Jira",
  stats: [
    { label: "Open", value: "3" },
    { label: "Blocked", value: "1" },
  ],
  more: {
    label: "and 3 more in To do",
    url: "https://example.atlassian.net/boards/7?status=todo",
  },
  groups: [
    {
      label: "In progress",
      rows: [
        {
          key: "AF-512",
          title: "Retry failed webhook deliveries",
          url: "https://example.atlassian.net/browse/AF-512",
          badge: { label: "High", tone: "bad" },
          trailing: "2d",
        },
      ],
    },
    {
      label: "Blocked",
      rows: [
        {
          key: "AF-471",
          title: "Rotate payment provider keys",
          detail: "Waiting on vendor",
          badge: { label: "Blocked", tone: "attention" },
        },
      ],
    },
  ],
};

test("a list card keeps its groups, names its one source once, and reads as text", () => {
  const { card, text, notes } = built(tickets);
  expect(notes).toEqual([]);
  expect(card).toEqual({
    type: "list",
    title: "AF board · open",
    url: "https://example.atlassian.net/boards/7",
    sources: ["Jira"],
    stats: [
      { label: "Open", value: "3" },
      { label: "Blocked", value: "1" },
    ],
    more: {
      label: "and 3 more in To do",
      url: "https://example.atlassian.net/boards/7?status=todo",
    },
    groups: [
      {
        label: "In progress",
        rows: [
          {
            key: "AF-512",
            title: "Retry failed webhook deliveries",
            url: "https://example.atlassian.net/browse/AF-512",
            badge: { label: "High", tone: "bad" },
            trailing: "2d",
          },
        ],
      },
      {
        label: "Blocked",
        rows: [
          {
            key: "AF-471",
            title: "Rotate payment provider keys",
            detail: "Waiting on vendor",
            badge: { label: "Blocked", tone: "attention" },
          },
        ],
      },
    ],
  });
  expect(text).toBe(
    [
      "AF board · open (Jira) — https://example.atlassian.net/boards/7",
      "3 Open · 1 Blocked",
      "",
      "In progress",
      "• AF-512 Retry failed webhook deliveries · High · 2d — https://example.atlassian.net/browse/AF-512",
      "",
      "Blocked",
      "• AF-471 Rotate payment provider keys · Waiting on vendor · Blocked",
      "",
      "and 3 more in To do — https://example.atlassian.net/boards/7?status=todo",
    ].join("\n"),
  );
});

test("rows from several sources each name theirs", () => {
  const { card, text } = built({
    title: "Waiting for your review",
    groups: [
      {
        rows: [
          { key: "#214", title: "Cache board queries", source: "GitHub" },
          { key: "#87", title: "Drop the export", source: "Bitbucket" },
          { key: "#90", title: "Bump the linter", source: "GitHub" },
        ],
      },
    ],
  });
  expect(card.sources).toEqual(["GitHub", "Bitbucket"]);
  expect(card.type === "list" && card.groups[0]!.rows).toEqual([
    { key: "#214", title: "Cache board queries", sources: [0] },
    { key: "#87", title: "Drop the export", sources: [1] },
    { key: "#90", title: "Bump the linter", sources: [0] },
  ]);
  expect(text).toBe(
    [
      "Waiting for your review",
      "",
      "• #214 Cache board queries · GitHub",
      "• #87 Drop the export · Bitbucket",
      "• #90 Bump the linter · GitHub",
    ].join("\n"),
  );
});

test("a link that is not http or https is left out, and the bot is told", () => {
  const { card, notes } = built({
    title: "Links",
    url: "javascript:alert(1)",
    groups: [
      {
        rows: [
          {
            title: "A file",
            url: "file:///etc/passwd",
            link: { label: "Open", url: "not a url" },
          },
          { title: "A page", url: "https://example.com/a" },
        ],
      },
    ],
  });
  expect(card.url).toBeUndefined();
  expect(card.type === "list" && card.groups[0]!.rows).toEqual([
    { title: "A file" },
    { title: "A page", url: "https://example.com/a" },
  ]);
  expect(notes).toEqual([
    "3 links were left out: a link must be a full http or https address.",
  ]);
});

test("a long list is cut to what a card holds, with a line for the rest", () => {
  const { card, notes } = built({
    title: "Everything",
    groups: [
      {
        label: "First",
        rows: Array.from({ length: 30 }, (_, n) => ({ title: `Row ${n}` })),
      },
      {
        label: "Second",
        rows: Array.from({ length: 30 }, (_, n) => ({ title: `More ${n}` })),
      },
    ],
  });
  if (card.type !== "list") throw new Error("Expected a list.");
  expect(card.groups.map((g) => g.rows.length)).toEqual([30, 10]);
  expect(card.more).toEqual({ label: "and 20 more" });
  expect(notes).toEqual([
    `Only the first ${MAX_CARD_ITEMS} were shown; 20 were left out.`,
  ]);
});

test("a card needs rows or events, and not both", () => {
  expect(buildCard({ title: "Empty" })).toEqual({
    error: expect.stringMatching(/at least one row or event/),
  });
  expect(buildCard({ title: "Empty", groups: [{ rows: [] }] })).toEqual({
    error: expect.stringMatching(/at least one row/),
  });
  expect(
    buildCard({
      title: "Both",
      groups: [{ rows: [{ title: "A" }] }],
      events: [{ title: "B", start: "2026-11-23" }],
    }),
  ).toEqual({ error: expect.stringMatching(/not both/) });
});

test("a timeline sorts a day, merges an event read twice, and marks overlaps and free time", () => {
  const { card, text } = built({
    title: "Monday 23 November",
    events: [
      {
        title: "Sprint planning",
        start: "2026-11-23T14:00:00+03:00",
        end: "2026-11-23T15:00:00+03:00",
        source: "Work",
        link: { label: "Join", url: "https://meet.example.com/abc" },
      },
      {
        title: "Dentist",
        start: "2026-11-23T14:30:00+03:00",
        end: "2026-11-23T15:15:00+03:00",
        detail: "Bole Road clinic",
        source: "Personal",
      },
      {
        title: "Standup",
        start: "2026-11-23T09:30:00+03:00",
        end: "2026-11-23T09:45:00+03:00",
        source: "Work",
      },
      {
        title: "Team farewell call",
        start: "2026-11-23T17:00:00+03:00",
        end: "2026-11-23T17:30:00+03:00",
        source: "Work",
      },
      {
        title: "team farewell call",
        start: "2026-11-23T17:00:00+03:00",
        end: "2026-11-23T17:30:00+03:00",
        source: "Personal",
        url: "https://calendar.example.com/e/9",
      },
      { title: "Mara's birthday", start: "2026-11-23", source: "Personal" },
    ],
  });
  // Sources are named in the order the card shows them.
  expect(card.sources).toEqual(["Personal", "Work"]);
  // Stored as strict JSON: no property may be undefined.
  expect(card).toStrictEqual(JSON.parse(JSON.stringify(card)));
  expect(card.type === "timeline" && card.items).toEqual([
    {
      kind: "event",
      title: "Mara's birthday",
      start: at("2026-11-23T00:00:00Z"),
      allDay: true,
      sources: [0],
    },
    {
      kind: "event",
      title: "Standup",
      start: at("2026-11-23T09:30:00+03:00"),
      end: at("2026-11-23T09:45:00+03:00"),
      sources: [1],
    },
    {
      kind: "gap",
      start: at("2026-11-23T09:45:00+03:00"),
      end: at("2026-11-23T14:00:00+03:00"),
    },
    {
      kind: "event",
      title: "Sprint planning",
      link: { label: "Join", url: "https://meet.example.com/abc" },
      badge: { label: "Overlaps", tone: "attention" },
      start: at("2026-11-23T14:00:00+03:00"),
      end: at("2026-11-23T15:00:00+03:00"),
      sources: [1],
    },
    {
      kind: "event",
      title: "Dentist",
      detail: "Bole Road clinic",
      badge: { label: "Overlaps", tone: "attention" },
      start: at("2026-11-23T14:30:00+03:00"),
      end: at("2026-11-23T15:15:00+03:00"),
      sources: [0],
    },
    {
      kind: "gap",
      start: at("2026-11-23T15:15:00+03:00"),
      end: at("2026-11-23T17:00:00+03:00"),
    },
    {
      kind: "event",
      title: "Team farewell call",
      url: "https://calendar.example.com/e/9",
      start: at("2026-11-23T17:00:00+03:00"),
      end: at("2026-11-23T17:30:00+03:00"),
      sources: [1, 0],
    },
  ]);
  expect(text).toBe(
    [
      "Monday 23 November",
      "",
      "• All day Mara's birthday · Personal",
      "• 09:30–09:45 Standup · Work",
      "• 14:00–15:00 Sprint planning · Overlaps · Work (Join: https://meet.example.com/abc)",
      "• 14:30–15:15 Dentist · Bole Road clinic · Overlaps · Personal",
      "• 17:00–17:30 Team farewell call · Work + Personal — https://calendar.example.com/e/9",
    ].join("\n"),
  );
});

test("a timeline over several days starts each day, and free time stays within one", () => {
  const { card } = built({
    title: "This week",
    events: [
      {
        title: "Review",
        start: "2026-11-24T10:00:00+03:00",
        end: "2026-11-24T11:00:00+03:00",
        badge: { label: "Tentative" },
      },
      {
        title: "Planning",
        start: "2026-11-23T16:00:00+03:00",
        end: "2026-11-23T17:00:00+03:00",
      },
    ],
  });
  expect(card.sources).toEqual([]);
  expect(card.type === "timeline" && card.items).toEqual([
    { kind: "day", date: "2026-11-23" },
    {
      kind: "event",
      title: "Planning",
      start: at("2026-11-23T16:00:00+03:00"),
      end: at("2026-11-23T17:00:00+03:00"),
    },
    { kind: "day", date: "2026-11-24" },
    {
      kind: "event",
      title: "Review",
      badge: { label: "Tentative", tone: "neutral" },
      start: at("2026-11-24T10:00:00+03:00"),
      end: at("2026-11-24T11:00:00+03:00"),
    },
  ]);
});

const timeline = (input: CardInput, timeZone?: string) => {
  const { card } = buildCard(input, timeZone ? { timeZone } : {}) as {
    card: Extract<ReturnType<typeof built>["card"], { type: "timeline" }>;
  };
  return card.items;
};

/** Each item in a few words, to read a whole timeline at a glance. */
const outline = (input: CardInput, timeZone?: string) =>
  timeline(input, timeZone).map((item) =>
    item.kind === "day"
      ? `day ${item.date}`
      : item.kind === "gap"
        ? `gap ${new Date(item.start).toISOString().slice(11, 16)}-${new Date(item.end).toISOString().slice(11, 16)}`
        : `${item.title}${item.badge ? ` [${item.badge.label}]` : ""}`,
  );

test("events are placed on the owner's days, whatever zone the calendar answers in", () => {
  const events = [
    {
      title: "Late call",
      start: "2026-11-23T22:00:00Z",
      end: "2026-11-23T23:00:00Z",
    },
    {
      title: "Breakfast",
      start: "2026-11-24T05:00:00Z",
      end: "2026-11-24T06:00:00Z",
    },
    { title: "Birthday", start: "2026-11-24" },
  ];
  // In Addis Ababa both are on the 24th, 01:00 and 08:00: one day, no heading.
  expect(outline({ title: "Week", events }, "Africa/Addis_Ababa")).toEqual([
    "Birthday",
    "Late call",
    "gap 23:00-05:00",
    "Breakfast",
  ]);
  expect(built({ title: "Week", events }).text.split("\n").slice(2)).toEqual([
    "2026-11-23",
    "• 22:00–23:00 Late call",
    "",
    "2026-11-24",
    "• All day Birthday",
    "• 05:00–06:00 Breakfast",
  ]);
  const local = buildCard(
    { title: "Week", events },
    {
      timeZone: "Africa/Addis_Ababa",
    },
  );
  expect("text" in local && local.text.split("\n").slice(2)).toEqual([
    "• All day Birthday",
    "• 01:00–02:00 Late call",
    "• 08:00–09:00 Breakfast",
  ]);
  // Without the owner's zone the dates stay as written: two days, each named
  // by its date, with the all-day event on its own.
  expect(outline({ title: "Week", events })).toEqual([
    "day 2026-11-23",
    "Late call",
    "day 2026-11-24",
    "Birthday",
    "Breakfast",
  ]);
});

test("free time starts after an event that runs past midnight", () => {
  expect(
    outline({
      title: "Weekend",
      events: [
        {
          title: "Party",
          start: "2026-11-23T22:00:00Z",
          end: "2026-11-24T02:00:00Z",
        },
        {
          title: "Early",
          start: "2026-11-24T01:00:00Z",
          end: "2026-11-24T01:30:00Z",
        },
        { title: "Breakfast", start: "2026-11-24T08:00:00Z" },
      ],
    }),
  ).toEqual([
    "day 2026-11-23",
    "Party [Overlaps]",
    "day 2026-11-24",
    "Early [Overlaps]",
    "gap 02:00-08:00",
    "Breakfast",
  ]);
});

test("an event without an end takes no free time for granted, and can overlap", () => {
  expect(
    outline({
      title: "Today",
      events: [
        {
          title: "Workshop",
          start: "2026-11-23T10:00:00Z",
          end: "2026-11-23T12:00:00Z",
        },
        { title: "Call", start: "2026-11-23T11:00:00Z" },
        // An end before the start is no end at all.
        {
          title: "Errand",
          start: "2026-11-23T13:00:00Z",
          end: "2026-11-23T12:30:00Z",
        },
        {
          title: "Lunch",
          start: "2026-11-23T15:00:00Z",
          end: "2026-11-23T16:00:00Z",
        },
        {
          title: "Review",
          start: "2026-11-23T17:00:00Z",
          end: "2026-11-23T18:00:00Z",
        },
      ],
    }),
  ).toEqual([
    "Workshop [Overlaps]",
    "Call [Overlaps]",
    "Errand",
    "Lunch",
    "gap 16:00-17:00",
    "Review",
  ]);
});

test("an event past what a card holds adds no source, and no note about its link", () => {
  const { card, notes } = built({
    title: "Busy",
    events: [
      ...Array.from({ length: MAX_CARD_ITEMS }, (_, n) => ({
        title: `Work ${n}`,
        start: `2026-11-23T${String(n % 24).padStart(2, "0")}:${n < 24 ? "00" : "30"}:00Z`,
        source: "Work",
      })),
      {
        title: "Left out",
        start: "2026-11-23T23:45:00Z",
        source: "Personal",
        url: "ftp://example.com/x",
      },
    ],
  });
  expect(card.sources).toEqual(["Work"]);
  expect(card.more).toEqual({ label: "and 1 more" });
  expect(notes).toEqual([
    `Only the first ${MAX_CARD_ITEMS} were shown; 1 was left out.`,
  ]);
});

test("an event that names no source has none, among events that do", () => {
  expect(
    timeline({
      title: "Today",
      events: [
        { title: "A", start: "2026-11-23T09:00:00Z", source: "Work" },
        { title: "B", start: "2026-11-23T10:00:00Z", source: "Home" },
        { title: "C", start: "2026-11-23T11:00:00Z" },
      ],
    }).map((item) => item.kind === "event" && item.sources),
  ).toEqual([[0], [1], undefined]);
});

test("a date the calendar does not have, and a blank title, are not shown", () => {
  expect(
    buildCard({
      title: "Today",
      events: [{ title: "Ghost", start: "2026-02-30" }],
    }),
  ).toEqual({ error: expect.stringMatching(/Event 1 \("Ghost"\)/) });
  expect(
    buildCard({ title: "  ", groups: [{ rows: [{ title: "A" }] }] }),
  ).toEqual({ error: "A card needs a title." });
  const { card } = built({
    title: "Rows",
    groups: [{ rows: [{ title: "  " }, { title: "Kept" }] }],
  });
  expect(card.type === "list" && card.groups[0]!.rows).toEqual([
    { title: "Kept" },
  ]);
  expect(
    buildCard({ title: "Rows", groups: [{ rows: [{ title: " " }] }] }),
  ).toEqual({ error: expect.stringMatching(/at least one row or event/) });
});

test("an event time without an offset is refused, with what to send instead", () => {
  expect(
    buildCard({
      title: "Today",
      events: [{ title: "Standup", start: "2026-11-23T09:30:00" }],
    }),
  ).toEqual({
    error: expect.stringMatching(/Event 1 \("Standup"\).*UTC offset/),
  });
});

const showing = (args: CardInput) =>
  chatModel({ tool: { name: "show_card", args } });

test("a card a bot shows is kept with its turn, survives a restart, and the bot is told to stay brief", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-cards-"));
  let app = await Gateway.open({ directory, ...showing(tickets) });
  try {
    const turn = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "1",
      text: "What is open on the AF board?",
    });
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    expect(
      (await app.chats.state()).turns.find((t) => t.id === turn.id)!.answer,
    ).toMatch(
      /^The card is shown to the owner under your reply\. Do not repeat/,
    );
    await app.close();
    app = await Gateway.open({ directory, ...showing(tickets) });

    const owner = app.actors.establish("web");
    const seen = await app.queries.session(owner, turn.sessionId);
    expect(seen.cards).toHaveLength(1);
    expect(seen.cards![0]).toMatchObject({
      conversationId: turn.sessionId,
      turnId: turn.id,
      card: { type: "list", title: "AF board · open", sources: ["Jira"] },
    });
    expect(seen.cards![0]).not.toHaveProperty("text");
    expect(seen.cards![0]).not.toHaveProperty("taskId");
    expect(seen.activity.some((e) => e.type === "card.shown")).toBe(true);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("a chat that cannot draw a card reads it as text after the reply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-cards-channel-"));
  const app = await Gateway.open({ directory, ...showing(tickets) });
  const thread = "discord:guild:channel:thread";
  try {
    const turn = await app.chats.send({
      source: "discord",
      actor: "owner",
      eventId: "1",
      text: "What is open on the AF board?",
      discordThreadId: thread,
      discordUserId: "initiator",
    });
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    const state = await app.chats.state();
    const answer = state.turns.find((t) => t.id === turn.id)!.answer!;
    expect(answer).toMatch(/added to your reply as a plain list/);
    const delivery = state.deliveries.find((d) => d.turnId === turn.id)!;
    expect(delivery.text).toBe(`${answer}\n\n${built(tickets).text}`);
    expect((await app.cards.state()).cards).toHaveLength(1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("in a task another bot handed off, a card is refused so the list goes in the reply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-cards-handoff-"));
  const app = await Gateway.open({ directory, ...showing(tickets) });
  try {
    await app.sessions.submitHandoff(app.actors.establish("web"), {
      eventId: "handoff:h1:1",
      text: "List the open tickets.",
      handoff: {
        id: "h1",
        kind: "task",
        bot: { id: "chief", name: "Chief of staff" },
        title: "Open tickets",
      },
    });
    await until(
      async () => (await app.chats.state()).turns[0]?.status === "done",
    );
    expect((await app.chats.state()).turns[0]!.answer).toMatch(
      /only your reply goes back to it/,
    );
    expect((await app.cards.state()).cards).toEqual([]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("a bad card goes back to the bot as an error and nothing is shown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-cards-error-"));
  const app = await Gateway.open({
    directory,
    ...showing({ title: "Nothing", groups: [{ rows: [] }] }),
  });
  try {
    const turn = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "1",
      text: "Any PRs?",
    });
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    expect(
      (await app.chats.state()).turns.find((t) => t.id === turn.id)!.answer,
    ).toMatch(/A card needs at least one row/);
    expect((await app.cards.state()).cards).toEqual([]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
