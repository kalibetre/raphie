import { CodeBlock } from "../../../shared/ui/code-block";
import { ToolDecision } from "../../approvals/presentation/tool-decision";
import type { DockItem } from "../application/dock";
import { AskCard } from "./ask-card";

/**
 * What waits on the owner, docked on the composer: the oldest question or
 * approval on top with its choices, the rest as edges peeking behind it.
 * Answering one brings up the next.
 */
export function QuestionDock({ items }: { items: DockItem[] }) {
  const top = items[0];
  if (!top) return null;
  const more = items.length - 1;
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
      <div className="question-dock-top" key={top.id}>
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
        </header>
        {top.ask ? (
          <AskCard ask={top.ask} />
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
