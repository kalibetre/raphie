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
  updatedAt: number | null;
};

export type SaveOwnerProfile = Omit<OwnerProfile, "updatedAt">;
