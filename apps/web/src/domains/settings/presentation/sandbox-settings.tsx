import { Box, FolderOpen } from "lucide-react";

import { Button } from "../../../shared/ui/button";
import {
  formatWorkspaceBytes as bytes,
  useSandbox,
} from "../infrastructure/use-sandbox";
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
  return (
    <>
      {query.error && (
        <p role="alert">
          Sandbox details could not refresh. Showing the last received policy.
        </p>
      )}
      <Group
        title="Execution provider"
        note="The provider runs commands against this bot’s durable workspace. Provider and limits are managed by the runtime."
      >
        <Row
          icon={<Box size={18} />}
          title={info.provider.name}
          description={`Active · Version ${info.provider.version} · Shell commands over a virtual filesystem`}
        >
          <span className="sandbox-status">Active</span>
        </Row>
        <Row
          title="Available capabilities"
          description="Supported shell commands and file processing. Network access, host files and native programs are unavailable. MCP integrations run separately with their own approvals."
        />
        <Row
          title="Isolation"
          description="Logical filesystem separation in a disposable worker. This is not OS or VM isolation. just-bash is the currently available provider."
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
          title="Checkpoint policy"
          description="A zero shell exit commits file changes. Failed or interrupted executions discard their changes. Shell state and temporary files do not persist."
        />
        <Row
          title="Current activity"
          description={`${info.executions.admitted} running or waiting · ${info.executions.capacity} admitted operations per bot · ${info.executions.runtimeConcurrency} simultaneous workers across the runtime`}
        />
      </Group>
      <Group
        title="Execution limits"
        note="Limits apply to each execution. A busy workspace queues its own conversations in order."
      >
        <Row
          title="Time"
          description={`${info.limits.timeoutMs / 1000} seconds, including worker startup`}
        />
        <Row
          title="Command and output"
          description={`${bytes(info.limits.sourceBytes)} command source · ${bytes(info.limits.outputBytes)} output`}
        />
        <Row
          title="Files"
          description={`${bytes(info.usage.fileBytes)} used of ${bytes(info.limits.fileBytes)} · ${info.usage.entries.toLocaleString()} of ${info.limits.entries.toLocaleString()} checkpoint entries`}
        />
        <Row
          title="Execution history"
          description={`${bytes(info.usage.receiptBytes)} used of ${bytes(info.limits.receiptsBytes)}. Retained receipts prevent duplicate writes during recovery. New executions stop at capacity.`}
        />
      </Group>
    </>
  );
}
