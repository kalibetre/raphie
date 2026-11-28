/** Every external messaging platform a bot can be reached through. */
export type ChannelPlatform = "discord" | "slack" | "telegram";

export type DiscordChannel = {
  allowedUserIds: string[];
  channelId: string;
  connected: boolean;
  tokenConfigured: boolean;
  conflict: boolean;
};

/** Read model only: the Slack tokens are never part of it. */
export type SlackChannel = {
  /** Slack member IDs. Only these accounts can use the bot. */
  allowedUserIds: string[];
  /** The one channel the bot answers @mentions in; empty for any channel it is in. */
  channelId: string;
  teamName: string;
  connected: boolean;
  tokenConfigured: boolean;
  conflict: boolean;
};

export type SaveSlackChannel = {
  botToken?: string;
  appToken?: string;
  allowedUserIds: string[];
  channelId?: string;
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
  slack: SlackChannel | null;
  telegram: TelegramChannel | null;
};

/** Trusted adapter metadata captured with an admitted channel turn. */
export type ChannelOrigin = {
  platform: ChannelPlatform;
  connectionId: string;
  conversationId: string;
  channelId: string;
  userId: string;
  messageId?: string;
  updateId?: number;
  guildId?: string;
  threadId?: string;
  chatType?: "private" | "group" | "supergroup";
};

export type HomeDestination = {
  id: string;
  platform: ChannelPlatform;
  conversationId: string;
  userId: string;
};

export type ChannelHomeSettings = {
  selected: string | null;
  destinations: HomeDestination[];
};
