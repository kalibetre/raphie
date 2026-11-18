import type { TurnFailure } from "@raphie/contracts";

/** The longest provider error kept with a failed reply. */
const DETAIL_LIMIT = 1000;

/**
 * Why a reply ended without an answer, in words the owner can act on.
 * `reason` and `detail` are the run's settlement (`runFailure` in the
 * harness): the reason code, and for a model error the provider's message.
 */
export function replyFailure(reason: string, detail?: unknown): TurnFailure {
  const message =
    MESSAGES[reason] ?? `The reply ended without an answer (${reason}).`;
  const text = detailText(detail);
  return text ? { message, detail: text } : { message };
}

/** The model finished its reply without writing any text. */
export const EMPTY_REPLY: TurnFailure = {
  message:
    "The model finished without writing any text. Send your message again, or try another model.",
};

/** The reply's work was stopped before it could settle. */
export const INTERRUPTED_REPLY: TurnFailure = {
  message:
    "The reply was interrupted before it finished. Send your message again.",
};

const MESSAGES: Record<string, string> = {
  model_error: "The model returned an error.",
  no_model:
    "No model is chosen for this conversation. Choose one in the composer, then send your message again.",
  turn_limit:
    "The bot used its limit of tool rounds for one reply. Send a message to let it carry on.",
  interrupted:
    "Raphie stopped while the model was answering, and the retries ran out. Send your message again.",
  aborted: "The reply was stopped.",
  reset: "The conversation was reset before the reply finished.",
  faulted:
    "The reply stopped on an internal error. Check Diagnostics, then send your message again.",
  restart_limit:
    "The reply kept stopping Raphie, so it was ended. Check Diagnostics, then send your message again.",
  orphaned:
    "The reply's work was lost when Raphie restarted. Send your message again.",
  nothing_to_answer: "There was nothing to answer.",
};

function detailText(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  const text =
    typeof detail === "string"
      ? detail
      : typeof detail === "object" &&
          "message" in detail &&
          typeof detail.message === "string"
        ? detail.message
        : JSON.stringify(detail);
  // Provider errors sometimes echo part of a credential; keep it out.
  const trimmed = text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "$1-…")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 …")
    .trim();
  if (!trimmed) return undefined;
  return trimmed.length > DETAIL_LIMIT
    ? `${trimmed.slice(0, DETAIL_LIMIT)}…`
    : trimmed;
}
