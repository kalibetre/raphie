import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { arr, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { Card } from "@raphie/contracts";

import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import {
  buildCard,
  cardResult,
  MAX_CARD_ITEMS,
  type StoredCard,
} from "../domain/card.ts";
import { Cards, type CardState } from "./card-store.ts";

const NO_TURN =
  "There is no reply in progress to show a card under. Put the list in your reply instead.";

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
   * replayed call finds the one it already showed. `null` without a turn.
   */
  async show(
    api: ToolExecutionApi,
    ctx: Context,
    card: Card,
    text: string,
  ): Promise<{ drawn: boolean } | null> {
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
      if (!turn) return null;
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
  badge: opt(
    obj({
      label: str({ minLength: 1, maxLength: 24 }),
      tone: opt(
        oneOf(["neutral", "good", "attention", "bad"], {
          description:
            "good for done or passing, attention when the owner should look, bad for failing or urgent, neutral otherwise.",
        }),
      ),
    }),
  ),
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

/** The `show_card` tool: a list or timeline the client draws under the reply. */
export function createCardTools(cards: CardService) {
  return defineExtension({
    name: "raphie.cards",
    sections: [
      section("cards", ({ agent }) => {
        if (!agent.tools.some((tool) => tool.name === "show_card")) return;
        return "When your answer is a set of items the owner will scan, such as a day's events, open tickets or pull requests waiting for review, call show_card with them instead of writing a list or table, then reply in one or two sentences with what matters most. Read every account or service that holds part of the answer and show them in one card, each item naming its source; when one could not be read, say so in the card's warning. Use a card only for items you read with a tool in this turn.";
      }),
    ],
    tools: [
      defineTool({
        name: "show_card",
        description: `Show the owner a card under your reply: a list of rows (groups), or the events of one or more days (events). Pass one of the two. At most ${MAX_CARD_ITEMS} items are shown; say what is left out in more.`,
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
                rows: arr(
                  obj({
                    key: opt(
                      str({
                        maxLength: 24,
                        description:
                          'A short identifier, such as "AF-512" or "#214".',
                      }),
                    ),
                    ...itemFields,
                    trailing: opt(
                      str({
                        maxLength: 16,
                        description:
                          'A short value at the end of the row, such as its age ("3d").',
                      }),
                    ),
                  }),
                ),
              }),
              {
                maxItems: 12,
                description: "For a list. One group without a label is fine.",
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
                    'A date and time with its UTC offset ("2026-11-23T14:00:00+03:00"), or only a date ("2026-11-23") for an all-day event.',
                }),
                end: opt(str({ maxLength: 40 })),
              }),
              {
                description:
                  "For a timeline. Pass every event as you read it, in any order: the card sorts them, merges one read from two calendars, and marks overlaps and free time.",
              },
            ),
          ),
        }),
        replay: "safe",
        execute: async (args, api, ctx) => {
          const built = buildCard(args);
          if ("error" in built)
            return {
              output: [{ type: "text", text: built.error }],
              isError: true,
            };
          const shown = await cards.show(api, ctx, built.card, built.text);
          if (!shown)
            return { output: [{ type: "text", text: NO_TURN }], isError: true };
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
