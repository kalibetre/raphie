/** Bot identities are issued by the runtime, never selected by model arguments. */
export type BotProfile = {
  id: string;
  name: string;
  description: string;
  soul: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export type SaveBotProfile = Pick<BotProfile, "name" | "description" | "soul">;

export type UpdateBotProfile = SaveBotProfile & { revision: number };
