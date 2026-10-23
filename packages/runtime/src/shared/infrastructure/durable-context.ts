import type { Conversation, Harness } from "@earendil-works/pi-durable";

import type { Telemetry } from "../application/telemetry.ts";

export interface DurableContext {
  telemetry: Telemetry;
  harness: Harness;
  root: Conversation;
  authorize(actor: string): void;
  options: { approvalTtlMs?: number; mcp?: unknown; memory?: unknown };
  observations: { attach(id: number): Promise<void> };
}
