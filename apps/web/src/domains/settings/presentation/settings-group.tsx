import type { ReactNode } from "react";

export function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="settings-group">
      <h2>{title}</h2>
      {note && <p>{note}</p>}
      {children && <div className="settings-card">{children}</div>}
    </div>
  );
}

export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
