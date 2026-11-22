import { defineDoc } from "@earendil-works/pi-durable";

import type { StoredCard } from "../domain/card.ts";

export type CardState = { cards: StoredCard[] };

/** Every card a bot showed, kept with the session it was shown in. */
export const Cards = defineDoc<CardState>({
  kind: "raphie.cards",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ cards: [] }),
});
