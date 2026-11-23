import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import {
  arr,
  bool,
  int,
  obj,
  oneOf,
  opt,
  str,
} from "@earendil-works/pi-schema";
import type { Card } from "@raphie/contracts";

import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { knownTimeZone } from "../../bots/domain/owner.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import {
  buildCard,
  type CardInput,
  cardResult,
  MAX_CARD_ITEMS,
  MAX_COLUMN_ROWS,
  type RowInput,
  type StoredCard,
} from "../domain/card.ts";
import { Cards, type CardState } from "./card-store.ts";

type ShowCardArgs = Omit<CardInput, "groups" | "events" | "columns"> & {
  kind: "list" | "timeline" | "board" | "item";
  groups?: (Omit<NonNullable<CardInput["columns"]>[number], "rows"> & {
    rows: (RowInput & { start?: string; end?: string })[];
  })[];
};

/** The tool's one-shape arguments as the card they ask for. */
function cardInput({ kind, groups, item, ...shared }: ShowCardArgs): CardInput {
  if (kind === "item") return { ...shared, item: item ?? {} };
  if (kind === "board") return { ...shared, columns: groups ?? [] };
  if (kind === "timeline")
    return {
      ...shared,
      // A row without a start cannot be placed; an empty one is refused.
      events: (groups ?? []).flatMap((group) =>
        group.rows.map((each) => ({ ...each, start: each.start ?? "" })),
      ),
    };
  return {
    ...shared,
    groups: (groups ?? []).map(({ label, rows }) => ({
      ...(label === undefined ? {} : { label }),
      rows,
    })),
  };
}

const NO_TURN =
  "There is no reply in progress to show a card under. Put the list in your reply instead.";

const HANDED_OFF =
  "This is a task another bot handed you, and only your reply goes back to it: a card would stay here unread. Put the list in your reply instead.";

export class CardService {
  app: DurableContext;

  constructor(app: DurableContext) {
    this.app = app;
  }

  /** Every card shown; empty before the first. */
  async state(): Promise<Readonly<CardState>> {
    return (await this.app.harness.snapshot(Cards, context)) ?? { cards: [] };
  }

  /**
   * The card for this call, stored once under the turn being answered: a
   * replayed call finds the one it already showed. Refused without a turn,
   * and in a task another bot handed off.
   */
  async show(
    api: ToolExecutionApi,
    ctx: Context,
    card: Card,
    text: string,
  ): Promise<{ drawn: boolean } | "no-turn" | "handed-off"> {
    return api.commit(async (tx) => {
      const state = await tx.doc(Cards);
      const chats = await tx.doc(Chats);
      const existing = state.cards.find((c) => c.taskId === api.taskId);
      const turn = existing
        ? chats.turns.find((t) => t.id === existing.turnId)
        : chats.turns.find(
            (t) =>
              t.conversationId === api.conversationId && t.status === "pending",
          );
      if (!turn) return "no-turn";
      // A handed-off task answers to the bot that sent it, which reads the
      // reply and nothing else.
      if (turn.handoff?.kind === "task") return "handed-off";
      // A chat reads the card as text, added to the reply it is sent.
      const drawn = !turn.replyTo;
      if (existing) return { drawn };
      const stored: StoredCard = {
        id: crypto.randomUUID(),
        taskId: api.taskId,
        conversationId: api.conversationId,
        turnId: turn.id,
        createdAt: Date.now(),
        card,
        text,
      };
      state.cards.push(stored);
      record(await tx.doc(Activity), "card.shown", "Showed a card", {
        conversationId: stored.conversationId,
        runId: turn.id,
        operationId: stored.id,
        details: { title: card.title, type: card.type },
      });
      return { drawn };
    }, ctx);
  }
}

// The schema is sent with every turn, so it stays small: one row shape for
// lists, boards and timelines, and the rules said once in the description.
// It sets no lengths or counts: a card that is over one would be refused
// whole, and a bot cannot count characters. The card cuts what is too long.
const text = (description?: string) => str(description ? { description } : {});

const badge = opt(
  obj({
    label: text(),
    tone: opt(oneOf(["neutral", "good", "attention", "bad"])),
  }),
);

/** What a task row and an item's field can both carry. */
const facts = {
  people: opt(arr(text())),
  tags: opt(arr(text())),
  due: opt(text()),
};

const row = obj({
  title: text(),
  key: opt(text('Its id, such as "AF-512".')),
  url: opt(text()),
  detail: opt(text("One short line, such as a place or an author.")),
  badge,
  link: opt(
    obj(
      { label: text(), url: text() },
      { description: 'One more link, such as "Join".' },
    ),
  ),
  source: opt(text("Its account or service, when the card mixes several.")),
  trailing: opt(text('A short value at the end, such as its age ("3d").')),
  ...facts,
  progress: opt(
    obj(
      {
        done: int(),
        total: int(),
      },
      { description: "Checklist steps done." },
    ),
  ),
  start: opt(text("Timeline only.")),
  end: opt(text()),
});

const DESCRIPTION = [
  "Show the owner a card under your reply. kind says which:",
  `list: rows in groups (up to ${MAX_CARD_ITEMS}).`,
  `timeline: events of one or more days, each row with start, and end when it has one (up to ${MAX_CARD_ITEMS}). Pass them as read, in any order: the card sorts them, merges one read from two calendars, and marks overlaps and free time.`,
  `board: a project's columns as groups, in the board's order and empty ones too, each with its colour when the service gives one and its count when it holds more than the rows you pass (${MAX_COLUMN_ROWS} shown a column).`,
  "item: one task or ticket opened up, in item; the card's title is its title.",
  'Times are ISO 8601 with a UTC offset ("YYYY-MM-DDTHH:MM:SS+03:00"), or a date ("YYYY-MM-DD") for an all-day event or a due date; leave due out once a task is done.',
  "Copy every url exactly from a tool result and leave it out when you have none; never write one from memory.",
  "Badge tones: good for done or passing, attention when the owner should look, bad for failing or urgent.",
  "people, tags, progress, due, key and trailing are for list and board rows; a timeline ignores them.",
  "Keep a badge, tag, key, stat and trailing value to a word or two; text too long for its place is cut.",
  "Say what a card leaves out in more.",
].join(" ");

/** The `show_card` tool: a list, timeline, board or item the client draws under the reply. */
export function createCardTools(
  cards: CardService,
  /** The owner's time zone, or "" when they have not said. */
  ownerTimeZone: () => string,
) {
  return defineExtension({
    name: "raphie.cards",
    tools: [
      defineTool({
        name: "show_card",
        description: DESCRIPTION,
        parameters: obj({
          kind: oneOf(["list", "timeline", "board", "item"]),
          title: text(),
          url: opt(text()),
          source: opt(text("Where every item came from, when they share it.")),
          warning: opt(
            text("What is missing, such as an account you could not read."),
          ),
          stats: opt(
            arr(obj({ label: text(), value: text() }), {
              description: "Headline numbers.",
            }),
          ),
          more: opt(obj({ label: text(), url: opt(text()) })),
          groups: opt(
            arr(
              obj({
                label: opt(text()),
                color: opt(
                  oneOf([
                    "gray",
                    "blue",
                    "green",
                    "yellow",
                    "orange",
                    "red",
                    "pink",
                    "purple",
                  ]),
                ),
                count: opt(int()),
                rows: arr(row),
              }),
            ),
          ),
          item: opt(
            obj({
              key: opt(text()),
              fields: opt(
                arr(
                  obj({
                    label: text(),
                    value: opt(text()),
                    badge,
                    ...facts,
                  }),
                  {
                    description:
                      "Its facts under labels: a status as badge, who has it as people, a date as due, tags, or text as value.",
                  },
                ),
              ),
              body: opt(text("Its description as plain text.")),
              steps: opt(
                arr(obj({ label: text(), done: opt(bool()) }), {
                  description: "Its whole checklist, in order.",
                }),
              ),
            }),
          ),
        }),
        replay: "safe",
        execute: async (args, api, ctx) => {
          const zone = ownerTimeZone();
          const built = buildCard(cardInput(args), {
            ...(knownTimeZone(zone) ? { timeZone: zone } : {}),
          });
          if ("error" in built)
            return {
              output: [{ type: "text", text: built.error }],
              isError: true,
            };
          const shown = await cards.show(api, ctx, built.card, built.text);
          if (typeof shown === "string")
            return {
              output: [
                {
                  type: "text",
                  text: shown === "handed-off" ? HANDED_OFF : NO_TURN,
                },
              ],
              isError: true,
            };
          return {
            output: [
              { type: "text", text: cardResult(built.notes, shown.drawn) },
            ],
          };
        },
      }),
    ],
  });
}
