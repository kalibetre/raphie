import { Button } from "../../../shared/ui/button";
import { Group } from "./settings-group";

/** A settings group that is loading, unavailable, or not applicable. */
export function SettingsStatus({
  title,
  message,
  onRetry,
  action = "Retry",
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  action?: string;
}) {
  return (
    <Group title={title}>
      <div className="settings-form">
        <p role="status">{message}</p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            {action}
          </Button>
        )}
      </div>
    </Group>
  );
}
