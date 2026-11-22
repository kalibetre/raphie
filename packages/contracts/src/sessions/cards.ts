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

/** How far a task's checklist has got. */
export type CardProgress = { done: number; total: number };

/** One row of a list or board card. */
export type CardRow = CardItem & {
  /** A short identifier before the title, such as "AF-512" or "#214". */
  key?: string;
  /** A short value at the end of the row, such as its age. */
  trailing?: string;
  /** Who it is assigned to, by name. Clients draw their initials. */
  people?: string[];
  tags?: string[];
  progress?: CardProgress;
  /** The calendar date it is due, as YYYY-MM-DD. */
  due?: string;
};

export type CardGroup = { label?: string; rows: CardRow[] };

/**
 * A column's colour, by name. Each client draws its own shade of it for
 * light and dark, so a colour from another service never clashes.
 */
export type CardColor =
  "gray" | "blue" | "green" | "yellow" | "orange" | "red" | "pink" | "purple";

/** One column of a board card, such as a status. */
export type CardColumn = {
  label: string;
  color: CardColor;
  /** Every item in the column, which may be more than the rows shown. */
  count: number;
  rows: CardRow[];
};

/** One labelled fact about an item: text, a badge, people, tags or a due date. */
export type CardField = {
  label: string;
  value?: string;
  badge?: CardBadge;
  people?: string[];
  tags?: string[];
  /** A calendar date, as YYYY-MM-DD. */
  due?: string;
};

/** An item's checklist: how far it has got, and its first few steps. */
export type CardSteps = CardProgress & {
  items: { label: string; done?: true }[];
};

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

/**
 * The start of another day, in a timeline that covers several: the calendar
 * date as YYYY-MM-DD, which reads the same in every time zone.
 */
export type CardDay = { kind: "day"; date: string };

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
  /** The columns of a board, each with its count and its first rows. */
  | { type: "board"; columns: CardColumn[] }
  /** One task or ticket opened up. */
  | {
      type: "item";
      /** A short identifier above the title, such as "#107". */
      key?: string;
      fields: CardField[];
      /** The start of its description, as plain text. */
      body?: string;
      steps?: CardSteps;
    }
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
