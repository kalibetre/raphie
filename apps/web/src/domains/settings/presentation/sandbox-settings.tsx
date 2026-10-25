import { Box, FolderOpen } from "lucide-react";

import { Button } from "../../../shared/ui/button";
import {
  formatWorkspaceBytes as bytes,
  useSandbox,
} from "../infrastructure/use-sandbox";
import { SandboxForm } from "./sandbox-form";
import { Group, Row } from "./settings-group";
import { SettingsStatus } from "./settings-status";

export function SandboxSettings({ onBrowse }: { onBrowse: () => void }) {
  const query = useSandbox();
  const info = query.data;
  if (!info)
    return (
      <SettingsStatus
        title="Execution provider"
        message={
          query.error
            ? "Could not load sandbox details. This backend may need an upgrade."
            : "Loading sandbox details…"
        }
        onRetry={query.error ? () => void query.refetch() : undefined}
      />
    );
  const container = info.provider.id === "container";
  return (
    <>
      {query.error && (
        <p role="alert">
          Sandbox details could not refresh. Showing the last received policy.
        </p>
      )}
      <SandboxForm
        info={info}
        pending={query.save.isPending}
        onSave={(input) => query.save.mutateAsync(input)}
      />
      <Group
        title="Execution provider"
        note={
          container
            ? "The provider runs commands against this bot’s durable workspace."
            : "The active just-bash provider has fixed, read-only limits."
        }
      >
        <Row
          icon={<Box size={18} />}
          title={info.provider.name}
          description={
            container
              ? info.settings.hostNetworkAcknowledged
                ? "Active · Native programs in a per-bot container"
                : "Awaiting acknowledgement · Native container provider"
              : `Active · Version ${info.provider.version} · Shell commands over a virtual filesystem`
          }
        >
          <span className="sandbox-status">
            {container && !info.settings.hostNetworkAcknowledged
              ? "Acknowledgement required"
              : "Active"}
          </span>
        </Row>
        <Row
          title="Available capabilities"
          description={
            container
              ? "Real files, git and native programs with open network. Host and local network services are reachable. Authenticated integrations use host-side MCP with their own approvals."
              : "Supported shell commands and file processing. Network access, host files and native programs are unavailable. MCP integrations run separately with their own approvals."
          }
        />
        <Row
          title="Isolation"
          description={
            container
              ? "Non-root container with a read-only system, limited memory, CPU and processes. Only this bot’s folder is mounted. Containers share a kernel; this is not VM isolation. Host/LAN network access is not blocked."
              : "Logical filesystem separation in a disposable worker. This is not OS or VM isolation."
          }
        />
      </Group>
      <Group
        title="Persistent workspace"
        action={
          <Button variant="outline" size="sm" onClick={onBrowse}>
            <FolderOpen size={14} />
            Browse files
          </Button>
        }
      >
        <Row
          title={info.root}
          description="Shared by this bot’s conversations and preserved across restarts. Other bots have separate files."
        />
        <Row
          title={container ? "File persistence" : "Checkpoint policy"}
          description={
            container
              ? `Files survive failed and interrupted commands and restarts. There is no rollback. Processes stop after ${info.settings.idleMinutes} idle minutes or on command timeout/abort; files remain. An interrupted command has an unknown outcome: inspect files before retrying.`
              : "A zero shell exit commits file changes. Failed or interrupted executions discard their changes. Shell state and temporary files do not persist."
          }
        />
        <Row
          title="Current activity"
          description={`${info.executions.admitted} running or waiting · ${info.executions.capacity} admitted operations per bot · ${info.executions.runtimeConcurrency} simultaneous workers across the runtime`}
        />
      </Group>
      <Group
        title="Execution limits"
        note="A busy workspace queues its own conversations in order."
      >
        <Row
          title="Time"
          description={`${info.limits.timeoutMs / 1000} seconds${container ? " per operation; container startup also has a CLI deadline" : ", including worker startup"}`}
        />
        <Row
          title="Command and output"
          description={`${bytes(info.limits.sourceBytes)} command source · ${bytes(info.limits.outputBytes)} output`}
        />
        <Row
          title="Files"
          description={`${info.usage.fileBytes === null ? "Usage unavailable" : `${bytes(info.usage.fileBytes)} used`}${info.limits.fileBytes === null ? " · No disk quota" : ` of ${bytes(info.limits.fileBytes)}`}${info.usage.entries !== null && info.limits.entries !== null ? ` · ${info.usage.entries.toLocaleString()} of ${info.limits.entries.toLocaleString()} checkpoint entries` : " · Quota is checked before commands, not enforced during writes"}`}
        />
        <Row
          title="Execution history"
          description={
            container
              ? "Interrupted operations are recorded and never replayed automatically. Durable receipts are retained up to 10,000 entries; new writes stop at capacity. File browsing does not consume receipts."
              : `${bytes(info.usage.receiptBytes ?? 0)} used of ${bytes(info.limits.receiptsBytes ?? 0)}. Retained receipts prevent duplicate writes during recovery. New executions stop at capacity.`
          }
        />
      </Group>
    </>
  );
}
