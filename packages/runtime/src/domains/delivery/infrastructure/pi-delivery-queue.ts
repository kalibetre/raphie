import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineDoc } from "@earendil-works/pi-durable";

import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import { State } from "../../approvals/infrastructure/pi-file-approvals.ts";
import { ToolApprovals } from "../../approvals/infrastructure/pi-tool-approvals.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import type { DeliveryQueue, RenderDelivery } from "../application/worker.ts";
import type { DeliveryIntent, DeliveryPlan } from "../domain/model.ts";

export const DeliveryPlans = defineDoc<{ plans: DeliveryPlan[] }>({
  kind: "raphie.delivery-plans",
  version: 1,
  scope: "session",
  initial: () => ({ plans: [] }),
});

export class PiDeliveryQueue implements DeliveryQueue {
  private readonly app: DurableContext;
  private readonly connectionId: string | undefined;

  constructor(app: DurableContext, connectionId?: string) {
    this.app = app;
    this.connectionId = connectionId;
  }

  forConnection(connectionId: string) {
    return new PiDeliveryQueue(this.app, connectionId);
  }

  claim(render: RenderDelivery) {
    return this.app.root.commit(async (tx) => {
      const plans = (await tx.doc(DeliveryPlans)).plans;
      const inScope = (item: { connectionId?: string }) =>
        !this.connectionId ||
        (item.connectionId ?? "legacy-discord") === this.connectionId;
      let next = plans
        .filter(inScope)
        .flatMap((p) => p.operations)
        .find((op) => op.status === "pending");
      if (!next) {
        const tools = await tx.doc(ToolApprovals);
        const files = await tx.doc(State);
        const chats = await tx.doc(Chats);
        const tool = tools.deliveries.find(
          (d) => d.status === "pending" && inScope(d),
        );
        const file = files.deliveries.find(
          (d) => d.status === "pending" && inScope(d),
        );
        const chat = chats.deliveries.find(
          (d) => d.status === "pending" && inScope(d),
        );
        let intent: DeliveryIntent;
        const original = tool ?? file ?? chat;
        if (tool)
          intent = {
            ...tool,
            source: "tool",
            approval: tools.approvals.find((a) => a.id === tool.approvalId)!,
            originalMessageId:
              tools.deliveries.find(
                (d) =>
                  d.approvalId === tool.approvalId && d.kind === "approval",
              )?.messageId ?? null,
          };
        else if (file)
          intent = {
            ...file,
            source: "file",
            approval: files.approvals.find((a) => a.id === file.approvalId)!,
            originalMessageId:
              files.deliveries.find(
                (d) =>
                  d.approvalId === file.approvalId && d.kind === "approval",
              )?.messageId ?? null,
          };
        else if (chat) intent = { ...chat, source: "chat" };
        else return null;
        // Rendering is local and completes before either a claim or network I/O.
        const payloads = await render(intent);
        if (!payloads.length)
          throw new Error("Delivery renderer produced an empty plan.");
        const plan: DeliveryPlan = {
          id: original!.id,
          source: intent.source,
          connectionId: original!.connectionId ?? "legacy-discord",
          operations: payloads.map((payload, index) => ({
            id: `${intent.source}:${intent.id}:${index}`,
            payload,
            status: index === 0 ? "sending" : "pending",
            messageId: null,
          })),
        };
        plans.push(plan);
        original!.status = "sending";
        next = plan.operations[0]!;
      }
      next.status = "sending";
      return { ...next };
    }, context);
  }

  settle(id: string, messageId: string | null) {
    return this.app.root.commit(async (tx) => {
      const plans = (await tx.doc(DeliveryPlans)).plans;
      const plan = plans.find((p) => p.operations.some((op) => op.id === id));
      const operation = plan?.operations.find((op) => op.id === id);
      if (!plan || !operation || operation.status !== "sending")
        throw new Error("Delivery operation is not claimed.");
      operation.status = messageId ? "sent" : "uncertain";
      operation.messageId = messageId;
      if (
        plan.operations.some(
          (op) => op.status === "pending" || op.status === "sending",
        )
      )
        return;
      const deliveries =
        plan.source === "tool"
          ? (await tx.doc(ToolApprovals)).deliveries
          : plan.source === "file"
            ? (await tx.doc(State)).deliveries
            : (await tx.doc(Chats)).deliveries;
      const original = deliveries.find((d) => d.id === plan.id)!;
      original.status = plan.operations.every((op) => op.status === "sent")
        ? "sent"
        : "uncertain";
      if ("messageId" in original)
        original.messageId = plan.operations[0]!.messageId;
      if ("error" in original && original.status === "uncertain")
        original.error =
          "Delivery outcome unknown; inspect the platform before retrying.";
    }, context);
  }
}
