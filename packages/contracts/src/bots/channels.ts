export type DiscordChannel = {
  allowedUserIds: string[];
  channelId: string;
  connected: boolean;
  tokenConfigured: boolean;
  conflict: boolean;
};

/** Why a saved Telegram connection is not receiving messages. */
export type TelegramProblem = "conflict" | "token" | "network" | "duplicate";

/** Read model only: the bot token is never part of it. */
export type TelegramChannel = {
  enabled: boolean;
  connected: boolean;
  tokenConfigured: boolean;
  botUsername: string;
  /** Verified Telegram user IDs. Only these accounts can use the bot. */
  verifiedUserIds: string[];
  /** Expiry of an issued, unused pairing code, if one is active. */
  pairingExpiresAt: number | null;
  problem: TelegramProblem | null;
};

export type SaveTelegramChannel = { botToken?: string; enabled?: boolean };

/** Shown once when issued; the runtime keeps only the live code in memory. */
export type TelegramPairingCode = { code: string; expiresAt: number };

export type ChannelSettings = {
  discord: DiscordChannel | null;
  telegram: TelegramChannel | null;
};

/** Trusted adapter metadata captured with an admitted channel turn. */
export type ChannelOrigin = {
  platform: "discord" | "telegram";
  connectionId: string;
  conversationId: string;
  channelId: string;
  userId: string;
  messageId?: string;
  updateId?: number;
  guildId?: string;
  threadId?: string;
};

export type HomeDestination = {
  id: string;
  platform: "discord" | "telegram";
  conversationId: string;
  userId: string;
};

export type ChannelHomeSettings = {
  selected: string | null;
  destinations: HomeDestination[];
};
