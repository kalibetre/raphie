import { ListChecks, SquareArrowOutUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/button";

/**
 * What background work waits on the owner for, as a card at the end of the
 * chat: the work item's title, a "Needs you" badge, its approvals and
 * questions (`children`), and a way to open the item.
 */
export function NeedsYouCard({
  title,
  children,
  onOpenItem,
}: {
  title: string;
  children?: ReactNode;
  onOpenItem?: () => void;
}) {
  return (
    <article className="work-card" aria-label={`Background work: ${title}`}>
      <header className="work-card-header">
        <span className="work-card-kind">
          <ListChecks size={13} aria-hidden="true" />
          <span className="work-card-kind-label">Background work</span>
        </span>
        <strong className="work-card-title" title={title}>
          {title}
        </strong>
        <span className="work-card-status">
          <span className="work-card-status-dot" aria-hidden="true" />
          Needs you
        </span>
      </header>
      <div className="work-card-body">{children}</div>
      {onOpenItem && (
        <footer className="work-card-footer">
          <Button variant="ghost" size="xs" onClick={onOpenItem}>
            <SquareArrowOutUpRight aria-hidden="true" />
            Open item
          </Button>
        </footer>
      )}
    </article>
  );
}
