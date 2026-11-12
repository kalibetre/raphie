import type { ToolApproval } from "../../domains/approvals/domain/tool-approval.ts";
import type { RenderDelivery } from "../../domains/delivery/application/worker.ts";
import { retryRateLimited, type TelegramApi, TelegramApiError } from "./api.ts";

/** Telegram rejects text over 4096 characters; stay well inside it. */
export const CHUNK_SIZE = 4000;

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const PREVIEW_BUDGET = 2400;

export const APPROVE = "ta:";

export const REJECT = "tr:";

export type TelegramOperation = {
  chatId: string;
  /** Present when an earlier message is edited instead of posting a new one. */
  messageId?: string;
  text: string;
  html?: boolean;
  buttons?: { text: string; data: string }[];
  document?: { filename: string; base64: string; caption: string };
};

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Never splits a surrogate pair; prefers a paragraph, line or word boundary. */
export function chunkText(text: string, size = CHUNK_SIZE) {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = size;
    const window = rest.slice(0, size);
    const boundary = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" "),
    );
    if (boundary > size / 2) cut = boundary + 1;
    else if (/[\uD800-\uDBFF]/.test(rest[cut - 1] ?? "")) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  return parts;
}

/** Escaped prefix whose HTML length stays within the budget. */
function escapedPrefix(text: string, budget: number) {
  let html = "";
  let used = 0;
  for (const char of text) {
    const next = escapeHtml(char);
    if (used + next.length > budget) return { html, truncated: true };
    html += next;
    used += next.length;
  }
  return { html, truncated: false };
}

function toolOperation(
  chatId: string,
  approval: ToolApproval,
  messageId?: string,
): TelegramOperation[] {
  const pending =
    approval.status === "pending" && Date.now() < approval.expiresAt;
  const title = escapeHtml(
    pending
      ? `Approve ${approval.server.slice(0, 80)}: ${approval.tool.slice(0, 120)}`
      : `Tool request ${approval.status}`,
  );
  const json = JSON.stringify(JSON.parse(approval.argumentsJson), null, 2);
  const preview = escapedPrefix(json, PREVIEW_BUDGET);
  const full = Buffer.from(json);
  const attach = preview.truncated && full.length <= MAX_DOCUMENT_BYTES;
  const note = !preview.truncated
    ? ""
    : attach
      ? "\nArguments are truncated here. The complete JSON follows in the next message; review it before approving."
      : "\nArguments are truncated here and too large to attach. Review them in the web workspace before approving.";
  const text =
    `<b>${title}</b>\n` +
    "Review the exact arguments below. Approval permits one call, which may change external data.\n" +
    `<pre>${preview.html}${preview.truncated ? "\n…" : ""}</pre>${escapeHtml(note)}\n` +
    `Expires: ${new Date(approval.expiresAt).toISOString()}\nRequest: ${escapeHtml(approval.id)}`;
  const operation: TelegramOperation = {
    chatId,
    messageId,
    text,
    html: true,
    ...(pending
      ? {
          buttons: [
            { text: "Approve once", data: `${APPROVE}${approval.id}` },
            { text: "Decline", data: `${REJECT}${approval.id}` },
          ],
        }
      : {}),
  };
  return !messageId && attach
    ? [
        operation,
        {
          chatId,
          text: "Full arguments",
          document: {
            filename: `tool-request-${approval.id}.json`,
            base64: full.toString("base64"),
            caption: `Full arguments for request ${approval.id}`,
          },
        },
      ]
    : [operation];
}

/** Store complete platform payloads before network I/O, as the Discord renderer does. */
export function telegramRenderer(): RenderDelivery {
  return async (intent) => {
    const chatId = intent.threadId.replace(/^telegram:/, "");
    const operations: TelegramOperation[] =
      intent.source === "chat"
        ? chunkText(intent.text || "(empty reply)").map((text) => ({
            chatId,
            text,
          }))
        : intent.source === "tool"
          ? toolOperation(
              chatId,
              intent.approval,
              intent.kind === "resolved"
                ? (intent.originalMessageId ?? undefined)
                : undefined,
            )
          : [
              {
                chatId,
                text: "File approvals are not supported in Telegram. Use the web workspace.",
              },
            ];
    return operations.map((operation) => JSON.stringify(operation));
  };
}

export function decodeTelegramOperation(payload: string) {
  // Only the trusted renderer writes these durable records, never inbound JSON.
  return JSON.parse(payload) as TelegramOperation;
}

/** Returns the platform message ID. Waits out 429 replies, which prove nothing was sent. */
export async function sendTelegramOperation(
  api: TelegramApi,
  operation: TelegramOperation,
  sleep?: (ms: number) => Promise<unknown>,
) {
  const keyboard = operation.buttons?.map((button) => ({
    text: button.text,
    callback_data: button.data,
  }));
  const message = {
    chat_id: operation.chatId,
    text: operation.text,
    ...(operation.html ? { parse_mode: "HTML" as const } : {}),
  };
  if (operation.messageId) {
    try {
      await retryRateLimited(
        () =>
          api.editMessageText({
            ...message,
            message_id: Number(operation.messageId),
            // An empty keyboard removes the buttons from a settled request.
            reply_markup: { inline_keyboard: keyboard ? [keyboard] : [] },
          }),
        sleep,
      );
    } catch (error) {
      // The message already shows this state, so the edit's goal is met.
      if (
        !(error instanceof TelegramApiError) ||
        !/message is not modified/i.test(error.message)
      )
        throw error;
    }
    return operation.messageId;
  }
  const sent = operation.document
    ? await retryRateLimited(
        () =>
          api.sendDocument(
            operation.chatId,
            operation.document!.filename,
            Buffer.from(operation.document!.base64, "base64"),
            operation.document!.caption,
          ),
        sleep,
      )
    : await retryRateLimited(
        () =>
          api.sendMessage({
            ...message,
            ...(keyboard
              ? { reply_markup: { inline_keyboard: [keyboard] } }
              : {}),
          }),
        sleep,
      );
  return String(sent.message_id);
}
