import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import type { FileRef } from "../../attachments/infrastructure/local-attachment-store.ts";
import { decideApproval, isDecision } from "../domain/decision.ts";
import type { Approval, Source } from "../domain/file-approval.ts";
import type { deliveryWorkflow } from "./pi-delivery-workflow.ts";
import { enqueue } from "./pi-delivery-workflow.ts";
import { InputError, State } from "./pi-file-approvals.ts";

type ApprovalContext = DurableContext & {
  options: DurableContext["options"] & {
    discordThreadId?: string;
    discordConnectionId?: string;
  };
  workflow: ReturnType<typeof deliveryWorkflow>;
};

export class FileApprovalService {
  private context: ApprovalContext;

  constructor(context: ApprovalContext) {
    this.context = context;
  }

  async accept(input: {
    source: Source;
    eventId: string;
    actor: string;
    text: string;
    files: FileRef[];
    discordThreadId?: string;
    connectionId?: string;
  }) {
    this.context.authorize(input.actor);
    if (!input.eventId || input.eventId.length > 200)
      throw new InputError("A stable event ID is required.");
    if (
      typeof input.text !== "string" ||
      input.text.length > 4000 ||
      (!input.text.trim() && !input.files.length)
    ) {
      throw new InputError(
        "Write a message (up to 4,000 characters) or attach a file.",
      );
    }
    if (input.files.length > 4)
      throw new InputError("Attach at most four files.");
    const requestKey = `${input.source}:${input.eventId}`;
    const fingerprint = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify([input.text, input.files]))
      .digest("hex");
    const id = await this.context.root.commit(async (tx) => {
      const state = await tx.doc(State);
      const existing = state.approvals.find((a) => a.requestKey === requestKey);
      if (existing) {
        const destination = state.deliveries.find(
          (d) => d.approvalId === existing.id,
        );
        if (
          input.source === "discord" &&
          (destination?.threadId !== input.discordThreadId ||
            (existing.connectionId ?? "legacy-discord") !==
              (input.connectionId ?? "legacy-discord"))
        )
          throw new InputError(
            "Request belongs to another Discord connection or thread.",
            403,
          );
        if (existing.fingerprint !== fingerprint)
          throw new InputError(
            "Event ID already used for different content.",
            409,
          );
        return existing.id;
      }
      const now = Date.now();
      const approval: Approval = {
        id: crypto.randomUUID(),
        requestKey,
        fingerprint,
        text: input.text,
        files: input.files,
        source: input.source,
        connectionId:
          input.connectionId ??
          this.context.options.discordConnectionId ??
          "legacy-discord",
        createdAt: now,
        expiresAt: now + (this.context.options.approvalTtlMs ?? 600_000),
        status: "pending",
        decidedVia: null,
        completedAt: null,
        results: [],
        effectCount: 0,
      };
      await tx.createTask(
        this.context.workflow,
        { approvalId: approval.id },
        { ownership: { kind: "conversation" } },
      );
      state.approvals.push(approval);
      enqueue(
        state,
        approval,
        "approval",
        input.source === "discord"
          ? (input.discordThreadId ??
              this.context.options.discordThreadId ??
              null)
          : (this.context.options.discordThreadId ?? null),
      );
      return approval.id;
    }, context);
    this.context.harness.resume();
    return id;
  }

  async decide(
    id: string,
    decision: "approved" | "rejected",
    actor: string,
    via: Source,
    threadId?: string,
    connectionId = "legacy-discord",
  ) {
    this.context.authorize(actor);
    if (!isDecision(decision)) throw new InputError("Invalid decision.");
    return this.context.root.commit(async (tx) => {
      const state = await tx.doc(State);
      const approval = state.approvals.find((a) => a.id === id);
      if (!approval) throw new InputError("Approval not found.", 404);
      if (via === "discord") {
        const destination = state.deliveries.find((d) => d.approvalId === id);
        if (
          destination?.threadId !== threadId ||
          (approval.connectionId ?? "legacy-discord") !== connectionId
        )
          throw new InputError(
            "Approval belongs to another Discord connection or thread.",
            403,
          );
      }
      if (approval.status !== "pending") return approval.status;
      approval.status = decideApproval(
        approval.status,
        approval.expiresAt,
        decision,
        Date.now(),
      );
      approval.decidedVia = via;
      enqueue(
        state,
        approval,
        "resolved",
        this.context.options.discordThreadId ?? null,
      );
      return approval.status;
    }, context);
  }

  /** Serial delivery pump calls these around the network operation. */
  async claimDelivery() {
    return this.context.root.commit(async (tx) => {
      const state = await tx.doc(State);
      const next = state.deliveries.find((d) => d.status === "pending");
      if (!next) return null;
      next.status = "sending";
      return { ...next };
    }, context);
  }

  async settleDelivery(
    id: string,
    messageId: string | null,
    error: string | null = null,
  ) {
    await this.context.root.commit(async (tx) => {
      const delivery = (await tx.doc(State)).deliveries.find(
        (d) => d.id === id,
      )!;
      delivery.status = error ? "uncertain" : "sent";
      delivery.messageId = messageId;
      delivery.error = error;
    }, context);
  }
}
