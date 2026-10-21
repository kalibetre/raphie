import type { Channel, ModelSelection } from "@raphie/contracts";

export type SendMessage = {
  source: Channel;
  actor: string;
  eventId: string;
  text: string;
  conversationId?: number;
  sessionId?: string;
  model?: ModelSelection;
  discordThreadId?: string;
  connectionId?: string;
};

export interface ConversationCommands {
  chooseModel(sessionId: string, model: ModelSelection): Promise<void>;
  send(
    input: SendMessage,
  ): Promise<{ id: string; conversationId: number; sessionId: string }>;
}
