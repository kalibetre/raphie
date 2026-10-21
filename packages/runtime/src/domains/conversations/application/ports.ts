import type { Channel } from "@raphie/contracts";

export type SendMessage = {
  source: Channel;
  actor: string;
  eventId: string;
  text: string;
  conversationId?: number;
  sessionId?: string;
  discordThreadId?: string;
  connectionId?: string;
};

export interface ConversationCommands {
  send(
    input: SendMessage,
  ): Promise<{ id: string; conversationId: number; sessionId: string }>;
}
