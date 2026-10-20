import type { Conversation, Harness } from "@earendil-works/pi-durable";

export interface DurableContext {
  harness: Harness;
  root: Conversation;
  authorize(actor: string): void;
  options: { approvalTtlMs?: number; mcp?: unknown };
  observations: { attach(id: number): Promise<void> };
}
