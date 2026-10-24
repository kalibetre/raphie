import type { ApprovalStatus, ModelSelection } from "@raphie/contracts";

import type {
  FileApprovalCommands,
  ToolApprovalCommands,
} from "../../domains/approvals/application/ports.ts";
import type {
  ConversationCommands,
  SendMessage,
} from "../../domains/conversations/application/ports.ts";
import { InputError } from "../../shared/application/input-error.ts";
import type { ActorAuthority, ActorContext } from "../access/actors.ts";

export type MessageReceipt = { id: string; sessionId: string };

type FileCommands = Pick<FileApprovalCommands, "accept" | "decide">;

type CopyInput = Pick<
  Parameters<FileApprovalCommands["accept"]>[0],
  "text" | "eventId" | "files"
>;

export interface SessionOperations {
  copy(actor: ActorContext, input: CopyInput): Promise<string>;
  decideFile(
    actor: ActorContext,
    id: string,
    decision: "approved" | "rejected",
  ): Promise<string>;
  submit(
    actor: ActorContext,
    input: {
      eventId: string;
      text: string;
      sessionId?: string;
      model?: ModelSelection;
    },
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
  private readonly files: FileCommands;

  constructor(
    authority: ActorAuthority,
    conversations: ConversationCommands,
    approvals: ToolApprovalCommands,
    files: FileCommands,
  ) {
    this.authority = authority;
    this.conversations = conversations;
    this.approvals = approvals;
    this.files = files;
  }

  async submit(
    actor: ActorContext,
    input: {
      eventId: string;
      text: string;
      sessionId?: string;
      model?: ModelSelection;
    },
  ) {
    const verified = this.authority.require(actor);
    const receipt = await this.conversations.send({
      eventId: input.eventId,
      text: input.text,
      sessionId: input.sessionId,
      model: input.model,
      source: verified.source,
      actor: verified.subject,
      discordThreadId: verified.threadId,
      connectionId: verified.connectionId,
    });
    return { id: receipt.id, sessionId: receipt.sessionId };
  }

  /** Internal: a due scheduled job, marked so clients show it as scheduled. */
  async submitScheduled(
    actor: ActorContext,
    input: {
      eventId: string;
      text: string;
      sessionId?: string;
      scheduled: { name: string };
    },
  ) {
    const verified = this.authority.require(actor);
    const receipt = await this.conversations.send({
      ...input,
      source: verified.source,
      actor: verified.subject,
    });
    return { id: receipt.id, sessionId: receipt.sessionId };
  }

  async chooseModel(
    actor: ActorContext,
    sessionId: string,
    model: ModelSelection,
  ) {
    const verified = this.authority.require(actor);
    if (verified.source !== "web")
      throw new InputError("Model selection requires a client interface.", 403);
    await this.conversations.chooseModel(sessionId, model);
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
      connectionId: verified.connectionId,
    });
  }

  async copy(actor: ActorContext, input: CopyInput) {
    const verified = this.authority.require(actor);
    return this.files.accept({
      ...input,
      source: verified.source,
      actor: verified.subject,
      discordThreadId: verified.threadId,
      connectionId:
        verified.source === "discord" ? verified.connectionId : undefined,
    });
  }

  async decideFile(
    actor: ActorContext,
    id: string,
    decision: "approved" | "rejected",
  ) {
    const verified = this.authority.require(actor);
    return this.files.decide(
      id,
      decision,
      verified.subject,
      verified.source,
      verified.threadId,
      verified.connectionId,
    );
  }

  async decide(
    actor: ActorContext,
    id: string,
    decision: "approved" | "rejected",
  ) {
    const verified = this.authority.require(actor);
    return this.approvals.decide(
      id,
      decision,
      verified.subject,
      verified.source,
      verified.threadId,
      verified.connectionId,
    );
  }
}
