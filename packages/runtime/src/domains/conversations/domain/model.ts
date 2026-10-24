import type { Channel as Source, ModelSelection } from "@raphie/contracts";

import type { ReplyDestination } from "../../channels/domain/binding.ts";

export type ChatConversation = {
  model?: ModelSelection;
  id: number;
  sessionId: string;
  title: string;
  createdAt: number;
};

export type ChatTurn = {
  id: string;
  requestKey: string;
  fingerprint: string;
  conversationId: number;
  source: Source;
  text: string;
  createdAt: number;
  status: "pending" | "done" | "error";
  answer: string | null;
  replyTo?: ReplyDestination | null;
  /** Started by a scheduled job; its text is the saved instruction. */
  scheduled?: { name: string };
};

export type ChatDelivery = {
  id: string;
  turnId: string;
  threadId: string;
  connectionId?: string;
  text: string;
  status: "pending" | "sending" | "sent" | "uncertain";
};
