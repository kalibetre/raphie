/** Bot identities are issued by the runtime, never selected by model arguments. */
export type BotProfile = {
  id: string;
  name: string;
  description: string;
  soul: string;
  /** Six-digit hex color; absent/null keeps automatic roster allocation. */
  color?: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export type SaveBotProfile = Pick<
  BotProfile,
  "name" | "description" | "soul" | "color"
>;

export type UpdateBotProfile = SaveBotProfile & { revision: number };
