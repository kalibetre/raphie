import { CircleAlert, Plus, RefreshCw, SearchX } from "lucide-react";

import { Button } from "../../shared/ui/button";

export function WorkspaceAlert({
  title,
  description,
  icon,
  onAction,
  action,
}: {
  title: string;
  description: string;
  icon: "connection" | "missing";
  onAction: () => void;
  action: string;
}) {
  const Icon = icon === "missing" ? SearchX : CircleAlert;
  const ActionIcon = icon === "missing" ? Plus : RefreshCw;
  return (
    <div className="workspace-alert-wrap">
      <section
        className="workspace-alert"
        role="alert"
        aria-labelledby="workspace-alert-title"
      >
        <div className="workspace-alert-icon">
          <Icon size={24} />
        </div>
        <h2 id="workspace-alert-title">{title}</h2>
        <p>{description}</p>
        <Button onClick={onAction}>
          <ActionIcon />
          {action}
        </Button>
      </section>
    </div>
  );
}
