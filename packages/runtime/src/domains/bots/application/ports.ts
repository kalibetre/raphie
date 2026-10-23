import type {
  BotProfile,
  SaveBotProfile,
  UpdateBotProfile,
} from "@raphie/contracts";

export interface BotProfiles {
  list(): BotProfile[];
  read(id: string): BotProfile;
  history(id: string): BotProfile[];
  create(input: SaveBotProfile): Promise<BotProfile>;
  update(id: string, input: UpdateBotProfile): Promise<BotProfile>;
}
