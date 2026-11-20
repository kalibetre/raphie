import type {
  AskAnswer,
  AskOption,
  AskStatus,
  Channel,
} from "@raphie/contracts";

import type { ReplyDestination } from "../../channels/domain/binding.ts";

export const MAX_ANSWER_LENGTH = 2000;

/** A question a bot asked the owner, as the runtime stores it. */
export type Ask = {
  id: string;
  /** The `ask_owner` call waiting for it; a replayed call finds it again. */
  taskId: number;
  conversationId: number;
  turnId: string;
  /** The Telegram or Discord chat the turn came from, where it is also asked. */
  replyTo?: ReplyDestination | null;
  /** In that chat, only the person who sent the message can answer. */
  discordUserId?: string;
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

/** A question posted to a chat, then edited once it is settled. */
export type AskDelivery = {
  id: string;
  askId: string;
  threadId: string;
  connectionId?: string;
  kind: "question" | "resolved";
  status: "pending" | "sending" | "sent" | "uncertain";
  messageId: string | null;
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

/** The question as a chat shows it, above its buttons or its answer. */
export function askChatText(ask: Ask) {
  const details = ask.options
    .filter((o) => o.detail)
    .map((o) => `• ${o.label}: ${o.detail}`);
  const lines = [ask.question, ...details];
  if (ask.status === "pending")
    lines.push(
      "",
      "To answer in your own words, use the web workspace or the desktop app.",
    );
  else if (ask.status === "answered" && ask.answer)
    lines.push(
      "",
      "choice" in ask.answer
        ? `You picked: ${ask.options[ask.answer.choice]!.label}`
        : `You answered: ${ask.answer.text}`,
    );
  else lines.push("", "No answer in time.");
  return lines.join("\n");
}

/** The Telegram button data for answer `choice`: "qa:<id>:<choice>". */
export const ASK_CALLBACK = "qa:";

export function askCallback(ask: Pick<Ask, "id">, choice: number) {
  return `${ASK_CALLBACK}${ask.id}:${choice}`;
}

/** The question and answer a button's data names, if it names one. */
export function parseAskCallback(data: string) {
  const match = /^qa:([a-f0-9-]{36}):([0-5])$/.exec(data);
  return match ? { id: match[1]!, choice: Number(match[2]) } : null;
}
