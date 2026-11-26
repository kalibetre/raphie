import type {
  Channel,
  ChannelOrigin,
  ModelSelection,
  Quote,
  TurnHandoff,
  TurnWork,
} from "@raphie/contracts";

export type SendMessage = {
  source: Channel;
  actor: string;
  eventId: string;
  text: string;
  origin?: ChannelOrigin;
  attachments?: string[];
  conversationId?: number;
  sessionId?: string;
  model?: ModelSelection;
  approvalMode?: "ask" | "full-access";
  /** An earlier message in the same session that this one quotes. */
  quote?: Pick<Quote, "turnId" | "author">;
  discordThreadId?: string;
  connectionId?: string;
  discordUserId?: string;
  /** Internal only: a due scheduled job. Never accepted from HTTP input. */
  scheduled?: { name: string };
  /** Internal only: another bot's task or result. Never accepted from HTTP input. */
  handoff?: TurnHandoff;
  work?: TurnWork;
};

export interface ConversationCommands {
  control?(
    sessionId: string,
    action: "stop" | "steer" | "queue",
    turnId?: string,
  ): Promise<void>;
  chooseModel(sessionId: string, model: ModelSelection): Promise<void>;
  /** Records that `replyCount` replies were read; returns the stored count. */
  markRead(sessionId: string, replyCount: number): Promise<number>;
  send(
    input: SendMessage,
  ): Promise<{ id: string; conversationId: number; sessionId: string }>;
}
