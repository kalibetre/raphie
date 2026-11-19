import type {
  Channel,
  ChannelOrigin,
  ModelSelection,
  TurnHandoff,
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
  discordThreadId?: string;
  connectionId?: string;
  discordUserId?: string;
  /** Internal only: a due scheduled job. Never accepted from HTTP input. */
  scheduled?: { name: string };
  /** Internal only: another bot's task or result. Never accepted from HTTP input. */
  handoff?: TurnHandoff;
};

export interface ConversationCommands {
  control?(
    sessionId: string,
    action: "stop" | "steer" | "queue",
    turnId?: string,
  ): Promise<void>;
  chooseModel(sessionId: string, model: ModelSelection): Promise<void>;
  /** Archives the session, or with `archived` false brings it back. */
  archive(sessionId: string, archived: boolean): Promise<void>;
  /** Records that `replyCount` replies were read; returns the stored count. */
  markRead(sessionId: string, replyCount: number): Promise<number>;
  send(
    input: SendMessage,
  ): Promise<{ id: string; conversationId: number; sessionId: string }>;
}
