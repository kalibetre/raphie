import type { Channel as Source } from "@raphie/contracts";

export type ChatConversation = {
  id: number;
  sessionId: string;
  title: string;
  discordThreadId: string | null;
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
};

export type ChatDelivery = {
  id: string;
  turnId: string;
  threadId: string;
  text: string;
  status: "pending" | "sending" | "sent" | "uncertain";
};
