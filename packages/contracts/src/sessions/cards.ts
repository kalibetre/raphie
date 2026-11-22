/** How a badge reads: plain, good news, something for the owner, or a problem. */
export type CardTone = "neutral" | "good" | "attention" | "bad";

export type CardBadge = { label: string; tone: CardTone };

/** A link out of a card. Always http or https. */
export type CardLink = { label: string; url: string };

/** One headline number above a card's rows. */
export type CardStat = { label: string; value: string };

type CardItem = {
  title: string;
  /** Where the title leads: the ticket, pull request or calendar event. */
  url?: string;
  /** One line under the title. */
  detail?: string;
  badge?: CardBadge;
  /** A second link beside the row, such as a meeting's "Join". */
  link?: CardLink;
  /** Positions in the card's `sources`. Set only when the card has several. */
  sources?: number[];
};

/** One row of a list card. */
export type CardRow = CardItem & {
  /** A short identifier before the title, such as "AF-512" or "#214". */
  key?: string;
  /** A short value at the end of the row, such as its age. */
  trailing?: string;
};

export type CardGroup = { label?: string; rows: CardRow[] };

/** One event of a timeline card. Times are in milliseconds since the epoch. */
export type CardEvent = CardItem & {
  kind: "event";
  start: number;
  end?: number;
  /** The event has a date and no time of day. */
  allDay?: true;
};

/** Free time between two events of the same day. */
export type CardGap = { kind: "gap"; start: number; end: number };

/** The start of another day, in a timeline that covers several. */
export type CardDay = { kind: "day"; at: number };

export type CardTimelineItem = CardEvent | CardGap | CardDay;

/**
 * What a bot shows the owner in place of a list in its reply: rows or a
 * day's events, drawn by the client from a fixed set of parts.
 */
export type Card = {
  title: string;
  /** Where the title leads: the board, query or calendar. */
  url?: string;
  /** Where the items came from. With several, each item names its own. */
  sources: string[];
  /** Something the card is missing, such as an account that was not read. */
  warning?: string;
  stats?: CardStat[];
  /** A line under the items for what the card leaves out. */
  more?: { label: string; url?: string };
} & (
  | { type: "list"; groups: CardGroup[] }
  | { type: "timeline"; items: CardTimelineItem[] }
);

/** A card a bot showed in a session, under the reply of the turn that made it. */
export type SessionCard = {
  id: string;
  conversationId: string;
  turnId: string;
  /** When the bot read the data: the card's "as of" time. */
  createdAt: number;
  card: Card;
};
