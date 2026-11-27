import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "../../../shared/ui/button";
import { CodeBlock } from "../../../shared/ui/code-block";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { ToolDecision } from "../../approvals/presentation/tool-decision";
import { type DockItem, dockLine } from "../application/dock";
import { AskCard } from "./ask-card";

/**
 * What waits on the owner, docked on the composer: the oldest question or
 * approval on top with its choices, the rest as edges peeking behind it.
 * Answering one brings up the next, and keyboard focus moves to it. Skip
 * sends the top one to the back; folding leaves one line on the composer
 * until something new arrives.
 */
export function QuestionDock({
  items,
  folded = false,
  onSkip,
  onFold,
  onUnfold,
}: {
  items: DockItem[];
  folded?: boolean;
  onSkip?: () => void;
  onFold?: () => void;
  onUnfold?: () => void;
}) {
  const top = items[0];
  const topRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  const wasFolded = useRef(folded);
  const shown = useRef(top?.id);
  // The answered item's button is gone: take focus to the next one, rather
  // than leaving it on the page.
  useEffect(() => {
    if (shown.current && shown.current !== top?.id) {
      const lost = document.activeElement === document.body;
      if (lost) topRef.current?.focus();
    }
    shown.current = top?.id;
  }, [top?.id]);
  // Folding or unfolding removes the button that was pressed: keep focus on
  // the dock.
  useEffect(() => {
    if (wasFolded.current !== folded) {
      if (document.activeElement === document.body) {
        (folded ? barRef.current : topRef.current)?.focus();
      }
    }
    wasFolded.current = folded;
  }, [folded]);
  if (!top) return null;
  const more = items.length - 1;
  if (folded) {
    return (
      <section
        className="question-dock"
        data-folded
        aria-label="Waiting on you"
      >
        <button
          type="button"
          ref={barRef}
          className="question-dock-bar"
          aria-expanded={false}
          onClick={onUnfold}
        >
          <span className="question-dock-count">{items.length} waiting</span>
          <span className="question-dock-line">
            <span className="question-dock-line-title">{top.title}</span>
            {" · "}
            {dockLine(top)}
          </span>
          <ChevronUp size={14} aria-hidden="true" />
          <span className="sr-only">Show</span>
        </button>
      </section>
    );
  }
  const label = `${top.title}, ${top.kind === "question" ? "question" : "approval"}${more ? `, ${more} more waiting` : ""}`;
  return (
    <section className="question-dock" aria-label="Waiting on you">
      {more > 1 && (
        <span
          className="question-dock-edge"
          data-depth="2"
          aria-hidden="true"
        />
      )}
      {more > 0 && (
        <span
          className="question-dock-edge"
          data-depth="1"
          aria-hidden="true"
        />
      )}
      <div
        className="question-dock-top"
        key={top.id}
        ref={topRef}
        tabIndex={-1}
        aria-label={label}
      >
        <header className="question-dock-header">
          <span className="question-dock-title">{top.title}</span>
          <span className="question-dock-kind">
            {top.kind === "question" ? "Question" : "Approval"}
          </span>
          <span className="question-dock-meta">
            {[more ? `+${more} waiting` : "", top.itemId]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {more > 0 && onSkip && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="question-dock-skip"
              onClick={onSkip}
            >
              Skip
            </Button>
          )}
          {onFold && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="question-dock-fold"
              aria-label="Hide for now"
              aria-expanded={true}
              title="Hide for now"
              onClick={onFold}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          )}
        </header>
        <ScrollArea className="question-dock-scroll">
          {top.ask ? (
            <AskCard ask={top.ask} ownWords={false} />
          ) : top.approval ? (
            <div className="question-dock-approval">
              <p className="question-dock-text">
                Run <code>{top.approval.tool}</code>
                {top.approval.server && ` on ${top.approval.server}`}?
              </p>
              <details className="question-dock-args">
                <summary>Arguments</summary>
                <CodeBlock>{pretty(top.approval.argumentsJson)}</CodeBlock>
              </details>
              <ToolDecision approval={top.approval} />
            </div>
          ) : null}
        </ScrollArea>
      </div>
    </section>
  );
}

function pretty(json: string) {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
