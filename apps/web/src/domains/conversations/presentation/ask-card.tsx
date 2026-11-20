import type { AskAnswer, SessionAsk } from "@raphie/contracts";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";

/**
 * A question the bot asked mid-turn. While the turn waits it offers the
 * answers as buttons, plus the owner's own words; afterwards it shows what
 * was answered.
 */
export function AskCard({ ask }: { ask: SessionAsk }) {
  const { workspace } = useBackend();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: (answer: AskAnswer) =>
      workspace.api<{ status: string }>(`/api/asks/${ask.id}`, answer),
  });
  const sent = send.variables;
  const answer =
    ask.answer ?? (send.isSuccess || send.isPending ? sent : undefined);

  if (ask.status !== "pending" || answer)
    return (
      <div className="ask-card ask-settled">
        <p className="ask-question">{ask.question}</p>
        <p className="ask-outcome">
          {answer ? (
            <>
              <span className="ask-dot" aria-hidden="true" />
              {"choice" in answer ? "You picked " : "You answered "}
              <strong>
                {"choice" in answer
                  ? ask.options[answer.choice]?.label
                  : answer.text}
              </strong>
            </>
          ) : (
            "No answer · the bot went on without one"
          )}
        </p>
      </div>
    );

  const busy = send.isPending;
  // Answers with details read better as rows than as buttons in a line.
  const rows = ask.options.some((o) => o.detail);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) send.mutate({ text: text.trim() });
  };
  return (
    <div className="ask-card" role="group" aria-label={ask.question}>
      <p className="ask-question">{ask.question}</p>
      {rows ? (
        <div className="ask-rows">
          {ask.options.map((option, choice) => (
            <button
              key={choice}
              type="button"
              className="ask-row"
              data-danger={(ask.danger && choice === 0) || undefined}
              disabled={busy}
              onClick={() => send.mutate({ choice })}
            >
              <span className="ask-row-label">{option.label}</span>
              {option.detail && (
                <span className="ask-row-detail">{option.detail}</span>
              )}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <div className="ask-options">
          {ask.options.map((option, choice) => (
            <Button
              key={choice}
              size="sm"
              variant={ask.danger && choice === 0 ? "destructive" : "outline"}
              className="ask-option"
              disabled={busy}
              onClick={() => send.mutate({ choice })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
      {writing ? (
        <form className="ask-own" onSubmit={submit}>
          <Input
            autoFocus
            value={text}
            maxLength={2000}
            placeholder="Your answer"
            aria-label="Your answer"
            onChange={(event) => setText(event.target.value)}
          />
          <Button size="sm" type="submit" disabled={busy || !text.trim()}>
            Send
          </Button>
        </form>
      ) : (
        <button
          type="button"
          className="ask-own-toggle"
          onClick={() => setWriting(true)}
        >
          Answer in your own words
        </button>
      )}
      {send.isError && (
        <p className="error" role="alert">
          {send.error instanceof Error
            ? send.error.message
            : "The answer was not sent. Try again."}
        </p>
      )}
    </div>
  );
}
