import type { ReactNode } from "react";

/** A titled settings card. Without children it is a note under a heading. */
export function Group({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  /** Group-level control beside the title, e.g. "Add connection". */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-group">
      <div className="settings-group-heading">
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {action}
      </div>
      {children && <div className="settings-card">{children}</div>}
    </div>
  );
}

/** One setting inside a group: optional icon tile, copy, then its control. */
export function Row({
  icon,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      {icon && (
        <span className="settings-row-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="settings-row-text">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
