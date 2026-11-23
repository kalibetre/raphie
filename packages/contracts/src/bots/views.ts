/** How a bot writes its replies; the defaults keep them short and plain. */
export type ReplyStyle = {
  length: "short" | "balanced" | "detailed";
  warmth: "plain" | "default" | "warm";
  /** Plain paragraphs, the default short lists, or headings, lists and tables. */
  formatting: "prose" | "default" | "structured";
  emoji: boolean;
};

/** Bot identities are issued by the runtime, never selected by model arguments. */
export type BotProfile = {
  id: string;
  name: string;
  description: string;
  personality: string;
  replyStyle: ReplyStyle;
  /** Six-digit hex color; absent/null keeps automatic roster allocation. */
  color?: string | null;
  /** What the bot may change by itself. */
  selfUpdates: SelfUpdates;
  /**
   * How this bot works, with its own tools and services and what the owner
   * wants done every time, kept by the owner and the bot together. Empty
   * until one of them writes it.
   */
  instructions: string;
  /** Who saved this revision; absent on revisions saved before bots could. */
  changedBy?: "owner" | "bot";
  /** The built-in personality this revision's text is, unchanged. */
  preset?: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export type SaveBotProfile = Pick<
  BotProfile,
  "name" | "description" | "personality" | "color"
> & {
  /** Omitted: a new bot starts at the defaults, an edit keeps its style. */
  replyStyle?: ReplyStyle;
  /**
   * Omitted: a new bot starts at the defaults, an edit keeps them. A field
   * left out, as from a client older than it, keeps its value too.
   */
  selfUpdates?: Partial<SelfUpdates>;
  /** Omitted: a new bot starts with none, an edit keeps them. */
  instructions?: string;
};

/**
 * What a bot may change by itself, without asking: each change is saved at
 * once, shown in the conversation, and can be undone.
 */
export type SelfUpdates = {
  /** Its own personality, saved as a new revision. */
  personality: boolean;
  /** The owner's profile, shared by every bot. */
  owner: boolean;
  /** Its own skills: writing new ones and editing any of them. */
  skills: boolean;
};

/** A built-in personality to start a bot from. */
export type PersonalityPreset = {
  id: string;
  name: string;
  /** One line on what the personality is like. */
  summary: string;
  personality: string;
};

export type UpdateBotProfile = SaveBotProfile & { revision: number };

/**
 * The owner as every bot knows them: one profile, shared by all bots.
 * Empty fields are simply not told to the bots.
 */
export type OwnerProfile = {
  name: string;
  /** What bots call the owner, when not their name ("Kal"). */
  callMe: string;
  /** An IANA time zone ("Africa/Addis_Ababa"), or "" when not set. */
  timeZone: string;
  /** A few lines about the owner, in their words. */
  about: string;
  /**
   * Raphie's instructions every bot follows, on the tools every bot has.
   * Fixed by the release: read-only, and updated with each one.
   */
  everyBotInstructions: string;
  updatedAt: number | null;
};

export type SaveOwnerProfile = Omit<
  OwnerProfile,
  "updatedAt" | "everyBotInstructions"
>;
