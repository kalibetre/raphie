import type { Attachment, Channel } from "@raphie/contracts";

import type { GatewayState, Source } from "../domain/file-approval.ts";
import type { ToolApproval, ToolDelivery } from "../domain/tool-approval.ts";

export interface ToolApprovalCommands {
  approvalMode(
    actor: string,
    sessionId: string,
    mode?: "ask" | "full-access",
  ): Promise<"ask" | "full-access">;
  listGrants(
    actor: string,
    sessionId: string,
  ): Promise<{ id: string; tool: string }[]>;
  revokeGrant(actor: string, sessionId: string, id: string): Promise<void>;
  state(): Promise<{ approvals: ToolApproval[]; deliveries: ToolDelivery[] }>;
  decide(
    id: string,
    decision: "approved" | "rejected",
    actor: string,
    via: Channel,
    threadId?: string,
    connectionId?: string,
    discordUserId?: string,
    scope?: "once" | "session",
  ): Promise<"approved" | "rejected" | "expired" | "pending">;
}

export interface FileApprovalCommands {
  state(): Promise<GatewayState>;
  accept(input: {
    source: Source;
    actor: string;
    eventId: string;
    text: string;
    files: Attachment[];
    discordThreadId?: string;
    connectionId?: string;
    discordUserId?: string;
  }): Promise<string>;
  decide(
    id: string,
    decision: "approved" | "rejected",
    actor: string,
    via: Source,
    threadId?: string,
    connectionId?: string,
    discordUserId?: string,
  ): Promise<string>;
}
