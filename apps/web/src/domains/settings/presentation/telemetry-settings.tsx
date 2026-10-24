import type { ReactNode } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Switch } from "../../../shared/ui/switch";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { Group, Row } from "./settings-group";

/** Trace collection controls with the trace list on the same page. */
export function TelemetrySettings({ traces }: { traces: ReactNode }) {
  const { workspace } = useBackend();
  const settings = useRuntimeSettings();
  if (workspace.botId !== "default")
    return (
      <>
        <Group
          title="Trace export"
          note="This bot’s conversation activity is available from the activity inspector. Trace export is currently available for the default bot."
        />
        {traces}
      </>
    );
  return (
    <>
      <Group
        title="Telemetry"
        note="Operational traces are stored on this backend for Diagnostics. No analytics service receives them."
      >
        <Row
          title="Collect diagnostic traces"
          description="Record run and model timings, token counts, errors, and tool activity. Prompts and tool payloads are excluded."
        >
          <Switch
            aria-label="Collect diagnostic traces"
            checked={settings.data?.telemetryEnabled ?? false}
            disabled={!settings.data || settings.update.isPending}
            onCheckedChange={(checked) =>
              settings.update.mutate({ telemetryEnabled: checked })
            }
          />
        </Row>
        <div className="settings-form">
          <p>
            Turning this off stops new traces. In-flight traces may finish
            exporting. Existing traces remain until retention removes them.
            Session Activity and recovery continue.
          </p>
          <p role="status">
            {settings.update.error?.message ??
              (settings.error
                ? "Could not load backend settings."
                : !settings.data
                  ? "Loading telemetry settings…"
                  : settings.data.telemetryEnabled
                    ? "Trace collection is on."
                    : "Trace collection is off.")}
          </p>
          {settings.error && (
            <Button variant="outline" onClick={() => void settings.refetch()}>
              Retry
            </Button>
          )}
        </div>
      </Group>
      {traces}
    </>
  );
}
