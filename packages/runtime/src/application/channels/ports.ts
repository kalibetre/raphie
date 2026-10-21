import type {
  FileApprovalCommands,
  ToolApprovalCommands,
} from "../../domains/approvals/application/ports.ts";
import type { Delivery } from "../../domains/approvals/domain/file-approval.ts";
import type { ToolDelivery } from "../../domains/approvals/domain/tool-approval.ts";
import type { AttachmentStore } from "../../domains/attachments/application/ports.ts";
import type { ConversationCommands } from "../../domains/conversations/application/ports.ts";
import type { ChatDelivery } from "../../domains/conversations/domain/model.ts";
import type { ActorAuthority } from "../access/actors.ts";
import type { SessionOperations } from "../sessions/operations.ts";

export interface ChannelServices extends FileApprovalCommands {
  actors: ActorAuthority;
  sessions: SessionOperations;
  files: AttachmentStore;
  chats: ConversationCommands & {
    claimDelivery(): Promise<ChatDelivery | null>;
    settleDelivery(id: string, status: "sent" | "uncertain"): Promise<void>;
  };
  toolApprovals: ToolApprovalCommands & {
    claimDelivery(): Promise<ToolDelivery | null>;
    settleDelivery(id: string, messageId: string | null): Promise<void>;
  };
  claimDelivery(): Promise<Delivery | null>;
  settleDelivery(
    id: string,
    messageId: string | null,
    error?: string | null,
  ): Promise<void>;
}
