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

/** The file-copy experiment predates Telegram; fail closed rather than skip its Discord checks. */
function fileSource(actor: ActorContext) {
  if (actor.source === "telegram")
    throw new InputError("File approvals are not available in Telegram.", 403);
  return actor.source;
}

type CopyInput = Pick<
  Parameters<FileApprovalCommands["accept"]>[0],
  "text" | "eventId" | "files"
>;

export interface SessionOperations {
  approvalMode(
    actor: ActorContext,
    sessionId: string,
    mode?: "ask" | "full-access",
  ): Promise<"ask" | "full-access">;
  listGrants(
    actor: ActorContext,
    sessionId: string,
  ): Promise<{ id: string; tool: string }[]>;
  revokeGrant(
    actor: ActorContext,
    sessionId: string,
    id: string,
  ): Promise<void>;
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
      attachments?: string[];
      sessionId?: string;
      model?: ModelSelection;
      approvalMode?: "ask" | "full-access";
    },
  ): Promise<MessageReceipt>;
  decide(
    actor: ActorContext,
    id: string,
    decision: "approved" | "rejected",
    scope?: "once" | "session",
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

  async approvalMode(
    actor: ActorContext,
    sessionId: string,
    mode?: "ask" | "full-access",
  ) {
    const verified = this.authority.require(actor);
    if (verified.source !== "web")
      throw new InputError("Approval mode requires a client interface.", 403);
    return this.approvals.approvalMode(verified.subject, sessionId, mode);
  }

  async listGrants(actor: ActorContext, sessionId: string) {
    const verified = this.authority.require(actor);
    if (verified.source !== "web")
      throw new InputError(
        "Grant management requires a client interface.",
        403,
      );
    return this.approvals.listGrants(verified.subject, sessionId);
  }

  async revokeGrant(actor: ActorContext, sessionId: string, id: string) {
    const verified = this.authority.require(actor);
    if (verified.source !== "web")
      throw new InputError(
        "Grant management requires a client interface.",
        403,
      );
    await this.approvals.revokeGrant(verified.subject, sessionId, id);
  }

  async control(
    actor: ActorContext,
    sessionId: string,
    action: "stop" | "steer" | "queue",
    turnId?: string,
  ) {
    const verified = this.authority.require(actor);
    if (verified.source !== "web")
      throw new InputError("Task control requires a client interface.", 403);
    if (!this.conversations.control)
      throw new InputError("Task control unavailable.", 503);
    await this.conversations.control(sessionId, action, turnId);
  }

  async submit(
    actor: ActorContext,
    input: {
      eventId: string;
      text: string;
      attachments?: string[];
      sessionId?: string;
      model?: ModelSelection;
      approvalMode?: "ask" | "full-access";
    },
  ) {
    const verified = this.authority.require(actor);
    const receipt = await this.conversations.send({
      eventId: input.eventId,
      text: input.text,
      attachments: input.attachments,
      sessionId: input.sessionId,
      model: input.model,
      approvalMode: verified.source === "web" ? input.approvalMode : undefined,
      source: verified.source,
      actor: verified.subject,
      discordThreadId: verified.threadId,
      connectionId: verified.connectionId,
      discordUserId: verified.discordUserId,
    });
    return { id: receipt.id, sessionId: receipt.sessionId };
  }

  /** Internal: a due scheduled job, marked so clients show it as scheduled. */
  async submitScheduled(
    actor: ActorContext,
    input: {
      eventId: string;
      text: string;
      attachments?: string[];
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
      discordUserId: verified.discordUserId,
    });
  }

  async copy(actor: ActorContext, input: CopyInput) {
    const verified = this.authority.require(actor);
    return this.files.accept({
      ...input,
      source: fileSource(verified),
      actor: verified.subject,
      discordThreadId: verified.threadId,
      connectionId:
        verified.source === "discord" ? verified.connectionId : undefined,
      discordUserId: verified.discordUserId,
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
      fileSource(verified),
      verified.threadId,
      verified.connectionId,
      verified.discordUserId,
    );
  }

  async decide(
    actor: ActorContext,
    id: string,
    decision: "approved" | "rejected",
    scope: "once" | "session" = "once",
  ) {
    const verified = this.authority.require(actor);
    return this.approvals.decide(
      id,
      decision,
      verified.subject,
      verified.source,
      verified.threadId,
      verified.connectionId,
      verified.discordUserId,
      scope,
    );
  }
}
