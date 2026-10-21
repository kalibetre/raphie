import type { ApprovalStatus } from "@raphie/contracts";

import type { ToolApprovalCommands } from "../../domains/approvals/application/ports.ts";
import type {
  ConversationCommands,
  SendMessage,
} from "../../domains/conversations/application/ports.ts";
import type { ActorContext } from "../access/actors.ts";
import type { ActorAuthority } from "../access/actors.ts";

export type MessageReceipt = { id: string; sessionId: string };

export interface SessionOperations {
  submit(
    actor: ActorContext,
    input: { eventId: string; text: string; sessionId?: string },
  ): Promise<MessageReceipt>;
  decide(
    actor: ActorContext,
    id: string,
    decision: "approved" | "rejected",
  ): Promise<ApprovalStatus>;
}

export class Sessions implements SessionOperations {
  private readonly authority: ActorAuthority;
  private readonly conversations: ConversationCommands;
  private readonly approvals: ToolApprovalCommands;

  constructor(
    authority: ActorAuthority,
    conversations: ConversationCommands,
    approvals: ToolApprovalCommands,
  ) {
    this.authority = authority;
    this.conversations = conversations;
    this.approvals = approvals;
  }

  async submit(
    actor: ActorContext,
    input: { eventId: string; text: string; sessionId?: string },
  ) {
    const verified = this.authority.require(actor);
    const receipt = await this.conversations.send({
      eventId: input.eventId,
      text: input.text,
      sessionId: input.sessionId,
      source: verified.source,
      actor: verified.subject,
      discordThreadId: verified.threadId,
    });
    return { id: receipt.id, sessionId: receipt.sessionId };
  }

  /** Compatibility admission retains numeric request fingerprints during client migration. */
  async submitLegacy(
    actor: ActorContext,
    input: Pick<SendMessage, "text" | "eventId" | "conversationId">,
  ) {
    const verified = this.authority.require(actor);
    return this.conversations.send({
      ...input,
      source: verified.source,
      actor: verified.subject,
      discordThreadId: verified.threadId,
    });
  }

  decide(actor: ActorContext, id: string, decision: "approved" | "rejected") {
    const verified = this.authority.require(actor);
    return this.approvals.decide(
      id,
      decision,
      verified.subject,
      verified.source,
      verified.threadId,
    );
  }
}
