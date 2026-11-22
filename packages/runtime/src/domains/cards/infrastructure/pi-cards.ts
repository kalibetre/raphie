import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
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
  cardResult,
  MAX_CARD_ITEMS,
  MAX_COLUMN_ROWS,
  type StoredCard,
} from "../domain/card.ts";
import { Cards, type CardState } from "./card-store.ts";

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

const link = (what: string) =>
  str({
    maxLength: 2000,
    description: `${what} Copy it exactly from a tool result; leave it out when you have none. Never write one from memory.`,
  });

const badge = opt(
  obj({
    label: str({ minLength: 1, maxLength: 24 }),
    tone: opt(
      oneOf(["neutral", "good", "attention", "bad"], {
        description:
          "good for done or passing, attention when the owner should look, bad for failing or urgent, neutral otherwise.",
      }),
    ),
  }),
);

/** What a task row and an item's field can both carry. */
const facts = {
  people: opt(
    arr(str({ minLength: 1, maxLength: 40 }), {
      maxItems: 4,
      description: "Who it is assigned to, by name.",
    }),
  ),
  tags: opt(arr(str({ minLength: 1, maxLength: 24 }), { maxItems: 4 })),
  due: opt(
    str({
      maxLength: 40,
      description:
        'The date it is due ("YYYY-MM-DD"). Leave it out once the task is done.',
    }),
  ),
};

const itemFields = {
  title: str({ minLength: 1, maxLength: 140 }),
  url: opt(link("The page for this item.")),
  detail: opt(
    str({
      maxLength: 140,
      description:
        "One short line under the title, such as a place or an author.",
    }),
  ),
  badge,
  link: opt(
    obj(
      {
        label: str({ minLength: 1, maxLength: 16 }),
        url: link("Where it leads."),
      },
      {
        description:
          'One more link beside the item, with a one-word label, such as "Join" for a meeting.',
      },
    ),
  ),
  source: opt(
    str({
      maxLength: 40,
      description:
        "The account or service this item came from, when the card mixes several.",
    }),
  ),
};

const rows = arr(
  obj({
    key: opt(
      str({
        maxLength: 24,
        description: 'A short identifier, such as "AF-512" or "#214".',
      }),
    ),
    ...itemFields,
    ...facts,
    progress: opt(
      obj(
        { done: int({ minimum: 0 }), total: int({ minimum: 1 }) },
        { description: "Checklist steps done, out of how many." },
      ),
    ),
    trailing: opt(
      str({
        maxLength: 16,
        description:
          'A short value at the end of the row, such as its age ("3d").',
      }),
    ),
  }),
);

/** The `show_card` tool: a list, timeline, board or item the client draws under the reply. */
export function createCardTools(
  cards: CardService,
  /** The owner's time zone, or "" when they have not said. */
  ownerTimeZone: () => string,
) {
  return defineExtension({
    name: "raphie.cards",
    sections: [
      section("cards", ({ agent }) => {
        if (!agent.tools.some((tool) => tool.name === "show_card")) return;
        return "When your answer is a set of items the owner will scan, such as a day's events, open tickets, pull requests waiting for review or the tasks on a board, or is one task opened up, call show_card with them instead of writing a list or table, then reply in one or two sentences with what matters most. Read every account or service that holds part of the answer and show them in one card, each item naming its source; when one could not be read, say so in the card's warning. Use a card only for items you read with a tool in this turn.";
      }),
    ],
    tools: [
      defineTool({
        name: "show_card",
        description: `Show the owner a card under your reply. Pass exactly one of: groups (a list of rows), events (a timeline of one or more days), columns (a board, such as a project's tasks by status) or item (one task or ticket opened up). A list or timeline shows at most ${MAX_CARD_ITEMS} items and a board ${MAX_COLUMN_ROWS} rows a column; say what is left out in more.`,
        parameters: obj({
          title: str({
            minLength: 1,
            maxLength: 80,
            description:
              'What the card shows, such as "AF board · open" or "Monday 23 November".',
          }),
          url: opt(link("The page the whole card comes from.")),
          source: opt(
            str({
              maxLength: 40,
              description:
                'Where every item came from, such as "Jira", when they share one source.',
            }),
          ),
          warning: opt(
            str({
              maxLength: 140,
              description:
                "What the card is missing, such as an account you could not read.",
            }),
          ),
          stats: opt(
            arr(
              obj({
                label: str({ minLength: 1, maxLength: 24 }),
                value: str({ minLength: 1, maxLength: 12 }),
              }),
              {
                maxItems: 4,
                description: "Up to four headline numbers above the items.",
              },
            ),
          ),
          more: opt(
            obj(
              {
                label: str({ minLength: 1, maxLength: 80 }),
                url: opt(link("Where the full list is.")),
              },
              {
                description:
                  'A line under the items for what is left out, such as "and 12 more in To do".',
              },
            ),
          ),
          groups: opt(
            arr(
              obj({
                label: opt(
                  str({
                    maxLength: 40,
                    description: "A heading, such as a status.",
                  }),
                ),
                rows,
              }),
              {
                maxItems: 12,
                description: "For a list. One group without a label is fine.",
              },
            ),
          ),
          columns: opt(
            arr(
              obj({
                label: opt(
                  str({
                    maxLength: 40,
                    description:
                      "The column's name; leave it out for items in no column.",
                  }),
                ),
                color: opt(
                  oneOf(
                    [
                      "gray",
                      "blue",
                      "green",
                      "yellow",
                      "orange",
                      "red",
                      "pink",
                      "purple",
                    ],
                    {
                      description:
                        "The nearest of these to the colour the service gives the column. Leave it out when it gives none.",
                    },
                  ),
                ),
                count: opt(
                  int({
                    minimum: 0,
                    description:
                      "How many items the column holds, when that is more than the rows you pass.",
                  }),
                ),
                rows,
              }),
              {
                maxItems: 12,
                description:
                  "For a board. Pass every column in the board's order, empty ones too.",
              },
            ),
          ),
          item: opt(
            obj(
              {
                key: opt(
                  str({
                    maxLength: 24,
                    description: 'Its identifier, such as "#107".',
                  }),
                ),
                fields: opt(
                  arr(
                    obj({
                      label: str({ minLength: 1, maxLength: 24 }),
                      value: opt(str({ maxLength: 140 })),
                      badge,
                      ...facts,
                    }),
                    {
                      maxItems: 8,
                      description:
                        'Its facts, each under a label: a status as a badge ("Column"), who has it as people ("Assigned"), a date as due ("Due"), tags, or plain text as value.',
                    },
                  ),
                ),
                body: opt(
                  str({
                    maxLength: 2000,
                    description:
                      "Its description as plain text; the card shows the start.",
                  }),
                ),
                steps: opt(
                  arr(
                    obj({
                      label: str({ minLength: 1, maxLength: 140 }),
                      done: opt(bool()),
                    }),
                    {
                      maxItems: 50,
                      description:
                        "Its whole checklist, in order; the card counts them and lists the first few.",
                    },
                  ),
                ),
              },
              {
                description:
                  "For one task, ticket or card opened up. The card's title is its title; put its comment count in more.",
              },
            ),
          ),
          events: opt(
            arr(
              obj({
                ...itemFields,
                start: str({
                  maxLength: 40,
                  description:
                    'A date and time in ISO 8601 with its UTC offset ("YYYY-MM-DDTHH:MM:SS+03:00"), or only a date ("YYYY-MM-DD") for an all-day event.',
                }),
                end: opt(str({ maxLength: 40 })),
              }),
              {
                description:
                  "For a timeline. Pass every event as you read it, in any order, with its end when it has one: the card sorts them, merges one read from two calendars, and marks overlaps and free time.",
              },
            ),
          ),
        }),
        replay: "safe",
        execute: async (args, api, ctx) => {
          const zone = ownerTimeZone();
          const built = buildCard(args, {
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
