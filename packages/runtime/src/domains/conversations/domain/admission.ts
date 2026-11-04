type MessageInput = {
  eventId: string;
  text: string;
  conversationId?: number;
  attachments?: string[];
};

export function messageViolation(input: MessageInput): string | undefined {
  if (
    typeof input.eventId !== "string" ||
    !input.eventId ||
    input.eventId.length > 200 ||
    typeof input.text !== "string" ||
    (!input.text.trim() && !input.attachments?.length) ||
    input.text.length > 4000
  )
    return "Send a message of 1–4,000 characters with a stable event ID.";
  if (
    input.attachments &&
    (!Array.isArray(input.attachments) ||
      input.attachments.length > 4 ||
      input.attachments.some(
        (id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id),
      ) ||
      new Set(input.attachments).size !== input.attachments.length)
  )
    return "Attach at most four unique uploaded files.";
  if (
    input.conversationId !== undefined &&
    (!Number.isSafeInteger(input.conversationId) || input.conversationId <= 0)
  )
    return "Invalid conversation ID.";
  return undefined;
}
