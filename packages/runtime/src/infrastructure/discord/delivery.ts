import type { AdapterPostableMessage, CardElement } from "chat";

import type { AttachmentStore } from "../../domains/attachments/application/ports.ts";
import type { RenderDelivery } from "../../domains/delivery/application/worker.ts";
import { approvalCard, toolApprovalCard } from "./cards.ts";

type DiscordOperation = {
  threadId: string;
  messageId?: string;
  raw?: string;
  card?: CardElement;
  files?: { filename: string; base64: string }[];
};

/** Store complete platform payloads before network I/O; bytes survive a restart too. */
export function discordRenderer(files: AttachmentStore): RenderDelivery {
  return async (intent) => {
    const base = { threadId: intent.threadId };
    if (intent.source === "chat") {
      const parts = [];
      for (let offset = 0; offset < intent.text.length; offset += 1900)
        parts.push(
          JSON.stringify({
            ...base,
            raw: intent.text.slice(offset, offset + 1900),
          }),
        );
      return parts;
    }
    const messageId =
      intent.kind === "resolved"
        ? (intent.originalMessageId ?? undefined)
        : undefined;
    const operation: DiscordOperation = { ...base, messageId };
    if (intent.source === "tool") {
      operation.card = toolApprovalCard(intent.approval);
      if (!messageId)
        operation.files = [
          {
            filename: `tool-request-${intent.approval.id}.json`,
            base64: Buffer.from(
              JSON.stringify(
                {
                  server: intent.approval.server,
                  tool: intent.approval.tool,
                  arguments: JSON.parse(intent.approval.argumentsJson),
                },
                null,
                2,
              ),
            ).toString("base64"),
          },
        ];
    } else if (intent.kind === "result") {
      operation.raw = `Completed request ${intent.approval.id}.`;
      operation.files = await Promise.all(
        intent.approval.results.map(async (file) => ({
          filename: file.name,
          base64: Buffer.from(await files.read(file.id)).toString("base64"),
        })),
      );
    } else operation.card = approvalCard(intent.approval);
    return [JSON.stringify(operation)];
  };
}

export function decodeDiscordOperation(payload: string) {
  // Only the trusted renderer writes these durable records, never inbound JSON.
  const operation = JSON.parse(payload) as DiscordOperation;
  const files = operation.files?.map((file) => ({
    filename: file.filename,
    data: Buffer.from(file.base64, "base64"),
  }));
  const message: AdapterPostableMessage =
    operation.messageId && operation.card
      ? operation.card
      : operation.card
        ? { card: operation.card, files }
        : { raw: operation.raw ?? "", files };
  return {
    threadId: operation.threadId,
    messageId: operation.messageId,
    message,
  };
}
