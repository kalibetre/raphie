import type {
  AskAnswer,
  AskOption,
  AskStatus,
  Channel,
} from "@raphie/contracts";

export const MAX_ANSWER_LENGTH = 2000;

/** A question a bot asked the owner, as the runtime stores it. */
export type Ask = {
  id: string;
  /** The `ask_owner` call waiting for it; a replayed call finds it again. */
  taskId: number;
  conversationId: number;
  turnId: string;
  question: string;
  options: AskOption[];
  danger?: true;
  createdAt: number;
  expiresAt: number;
  status: AskStatus;
  answer: AskAnswer | null;
  answeredVia: Channel | null;
  answeredApp?: "desktop";
};

/** `answer`, if it is one of `ask`'s options or the owner's own words. */
export function validAnswer(ask: Pick<Ask, "options">, answer: unknown) {
  if (typeof answer !== "object" || answer === null) return null;
  if ("choice" in answer) {
    const choice = answer.choice;
    return Number.isInteger(choice) &&
      (choice as number) >= 0 &&
      (choice as number) < ask.options.length
      ? { choice: choice as number }
      : null;
  }
  if ("text" in answer && typeof answer.text === "string") {
    const text = answer.text.trim();
    return text && text.length <= MAX_ANSWER_LENGTH ? { text } : null;
  }
  return null;
}

/** A settled question stays settled; an answer after the deadline is late. */
export function answerStatus(
  status: AskStatus,
  expiresAt: number,
  now: number,
): AskStatus {
  if (status !== "pending") return status;
  return now >= expiresAt ? "expired" : "answered";
}

/** What the bot reads back from its `ask_owner` call. */
export function askResult(ask: Ask) {
  if (ask.status === "answered" && ask.answer)
    return "choice" in ask.answer
      ? `The owner chose: ${ask.options[ask.answer.choice]!.label}`
      : `The owner answered in their own words: ${ask.answer.text}`;
  return "The owner did not answer in time. Do not assume an answer: say what you need from them in your reply and stop.";
}
