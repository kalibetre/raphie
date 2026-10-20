type MessageInput = { eventId: string; text: string; conversationId?: number };

export function messageViolation(input: MessageInput): string | undefined {
  if (
    typeof input.eventId !== "string" ||
    !input.eventId ||
    input.eventId.length > 200 ||
    typeof input.text !== "string" ||
    !input.text.trim() ||
    input.text.length > 4000
  )
    return "Send a message of 1–4,000 characters with a stable event ID.";
  if (
    input.conversationId !== undefined &&
    (!Number.isSafeInteger(input.conversationId) || input.conversationId <= 0)
  )
    return "Invalid conversation ID.";
  return undefined;
}
