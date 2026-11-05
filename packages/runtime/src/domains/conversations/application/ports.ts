import type { Channel, ModelSelection } from "@raphie/contracts";

export type SendMessage = {
  source: Channel;
  actor: string;
  eventId: string;
  text: string;
  attachments?: string[];
  conversationId?: number;
  sessionId?: string;
  model?: ModelSelection;
  approvalMode?: "ask" | "full-access";
  discordThreadId?: string;
  connectionId?: string;
  discordUserId?: string;
  /** Internal only: a due scheduled job. Never accepted from HTTP input. */
  scheduled?: { name: string };
};

export interface ConversationCommands {
  control?(
    sessionId: string,
    action: "stop" | "steer" | "queue",
    turnId?: string,
  ): Promise<void>;
  chooseModel(sessionId: string, model: ModelSelection): Promise<void>;
  send(
    input: SendMessage,
  ): Promise<{ id: string; conversationId: number; sessionId: string }>;
}
