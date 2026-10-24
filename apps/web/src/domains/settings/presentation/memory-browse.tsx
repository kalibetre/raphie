import { useMemory } from "../infrastructure/use-memory";
import { MemoryEvidenceBrowser } from "./memory-evidence-browser";
import { SettingsStatus } from "./settings-status";

/** Settings → Memory → Browse memory: the saved evidence, apart from configuration. */
export function MemoryBrowse() {
  const memory = useMemory();
  const status = memory.data;
  if (!status)
    return (
      <SettingsStatus
        title="Saved memories"
        message={
          memory.error
            ? "Memory is unavailable. This backend may need an update."
            : "Loading memories…"
        }
        onRetry={memory.error ? () => void memory.refetch() : undefined}
      />
    );
  return status.configuration.enabled ? (
    <MemoryEvidenceBrowser
      key={JSON.stringify(status.configuration)}
      canManage={status.capabilities.revise && status.capabilities.forget}
      canBrowse={status.capabilities.browse}
      liveSearch={status.configuration.provider === "builtin"}
      scope={status.configuration.scope}
    />
  ) : (
    <SettingsStatus
      title="Memory is off"
      message="Turn on memory in Settings → Memory to save and browse memories."
    />
  );
}
