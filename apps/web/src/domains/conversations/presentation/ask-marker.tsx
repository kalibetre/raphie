import type { SessionAsk } from "@raphie/contracts";
import { Check } from "lucide-react";

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Where a question was asked, in the conversation: a one-line marker while
 * it waits (the dock on the composer asks it), then a receipt of the answer.
 */
export function AskMarker({ ask, title }: { ask: SessionAsk; title: string }) {
  const at = (
    <time dateTime={new Date(ask.createdAt).toISOString()}>
      {time(ask.createdAt)}
    </time>
  );
  if (ask.status === "pending")
    return (
      <p className="ask-marker" title={ask.question}>
        <span className="ask-marker-dot" aria-hidden="true" />
        <span>
          {title} asked you something · {at}
        </span>
      </p>
    );
  const answer = ask.answer;
  return (
    <p className="ask-receipt" title={ask.question}>
      <span className="ask-receipt-tick" aria-hidden="true">
        <Check size={9} strokeWidth={3} />
      </span>
      <span>
        {answer ? (
          <>
            You answered{" "}
            <strong className="ask-receipt-answer">
              {"choice" in answer
                ? ask.options[answer.choice]?.label
                : `“${answer.text}”`}
            </strong>
          </>
        ) : (
          "No answer, so it went on without one"
        )}{" "}
        · {title} · {at}
      </span>
    </p>
  );
}
