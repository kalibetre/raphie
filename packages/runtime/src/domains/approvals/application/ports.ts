import type { Attachment, Channel } from "@raphie/contracts";

import type { GatewayState } from "../domain/file-approval.ts";
import type { ToolApproval, ToolDelivery } from "../domain/tool-approval.ts";

export interface ToolApprovalCommands {
  state(): Promise<{ approvals: ToolApproval[]; deliveries: ToolDelivery[] }>;
  decide(
    id: string,
    decision: "approved" | "rejected",
    actor: string,
    via: Channel,
    threadId?: string,
    connectionId?: string,
    discordUserId?: string,
  ): Promise<"approved" | "rejected" | "expired" | "pending">;
}

export interface FileApprovalCommands {
  state(): Promise<GatewayState>;
  accept(input: {
    source: Channel;
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
    via: Channel,
    threadId?: string,
    connectionId?: string,
    discordUserId?: string,
  ): Promise<string>;
}
