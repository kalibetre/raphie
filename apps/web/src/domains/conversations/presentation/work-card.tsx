import {
  CalendarClock,
  ListChecks,
  Reply,
  SquareArrowOutUpRight,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

/** Where a run's state shows in the card's header. */
export type WorkCardStatus =
  "working" | "done" | "failed" | "cancelled" | "needs-you";

const statusLabel: Record<WorkCardStatus, string> = {
  working: "Working",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  "needs-you": "Needs you",
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * One run of a work item in the chat: a scheduled job's post, background
 * work's result, or what background work waits on the owner for. It is not
 * a message: the header says which item produced it, the body holds what
 * came back (`text`, folded when long) and then anything else, such as the
 * run's tool steps or a question (`children`, never folded); the footer leads
 * to the item.
 */
export function WorkCard({
  kind,
  title,
  itemId,
  at,
  status,
  text,
  children,
  onQuote,
  onOpenItem,
  id,
  hint,
}: {
  kind: "scheduled" | "background";
  title: string;
  itemId?: string;
  at?: number;
  status?: WorkCardStatus;
  text?: ReactNode;
  children?: ReactNode;
  onQuote?: () => void;
  onOpenItem?: () => void;
  /** The anchor a quote of this card's text scrolls to. */
  id?: string;
  /** The title's tooltip; the title itself when not given. */
  hint?: string;
}) {
  const Icon = kind === "scheduled" ? CalendarClock : ListChecks;
  const footer = onQuote || onOpenItem || (at && status);
  return (
    <article
      className="work-card"
      id={id}
      aria-label={`${kind === "scheduled" ? "Scheduled job" : "Background work"}: ${title}`}
    >
      <header className="work-card-header">
        <span className="work-card-kind">
          <Icon size={13} aria-hidden="true" />
          <span className="work-card-kind-label">
            {kind === "scheduled" ? "Scheduled" : "Background work"}
          </span>
        </span>
        <strong className="work-card-title" title={hint ?? title}>
          {title}
        </strong>
        {itemId && <span className="work-card-id">{itemId}</span>}
        {status ? (
          <span className="work-card-status" data-status={status}>
            <span aria-hidden="true" />
            {statusLabel[status]}
          </span>
        ) : (
          at && <time dateTime={new Date(at).toISOString()}>{time(at)}</time>
        )}
      </header>
      {(text || children) && (
        <div className="work-card-body">
          {text && <Folded>{text}</Folded>}
          {children}
        </div>
      )}
      {footer && (
        <footer className="work-card-footer">
          {onQuote && (
            <Button variant="ghost" size="xs" onClick={onQuote}>
              <Reply aria-hidden="true" />
              Quote
            </Button>
          )}
          {onOpenItem && (
            <Button variant="ghost" size="xs" onClick={onOpenItem}>
              <SquareArrowOutUpRight aria-hidden="true" />
              Open item
            </Button>
          )}
          {status && at && (
            <time dateTime={new Date(at).toISOString()}>{time(at)}</time>
          )}
        </footer>
      )}
    </article>
  );
}

/** A body taller than about four lines folds, with a way to unfold it. */
function Folded({ children }: { children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () =>
      // The folded height, from the CSS, plus a line's slack.
      setTall(element.scrollHeight > element.clientHeight + 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div
        ref={body}
        className="work-card-content"
        data-folded={open ? undefined : true}
        data-overflow={tall ? true : undefined}
      >
        {children}
      </div>
      {(tall || open) && (
        <button
          type="button"
          className="work-card-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
