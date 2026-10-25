import type {
  SandboxInfo,
  SandboxProvider,
  SandboxSettings,
  SaveSandboxSettings,
} from "@raphie/contracts";
import { useEffect, useState } from "react";

import { Input } from "../../../shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { Switch } from "../../../shared/ui/switch";
import { SaveBar } from "./save-bar";
import { Group, Row } from "./settings-group";
import { useSettingsGuard } from "./use-settings-guard";

export function SandboxForm({
  info,
  pending,
  onSave,
}: {
  info: SandboxInfo;
  pending: boolean;
  onSave: (input: SaveSandboxSettings) => Promise<SandboxSettings>;
}) {
  const [saved, setSaved] = useState(info.settings);
  const [provider, setProvider] = useState(saved.provider);
  const [acknowledged, setAcknowledged] = useState(
    saved.hostNetworkAcknowledged,
  );
  const [idle, setIdle] = useState(String(saved.idleMinutes));
  const [quota, setQuota] = useState(
    saved.diskQuotaMiB === null ? "" : String(saved.diskQuotaMiB),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty =
    provider !== saved.provider ||
    acknowledged !== saved.hostNetworkAcknowledged ||
    idle !== String(saved.idleMinutes) ||
    quota !== (saved.diskQuotaMiB === null ? "" : String(saved.diskQuotaMiB));
  const guard = useSettingsGuard(dirty, pending);
  const changedElsewhere = info.settings.revision !== saved.revision;
  const valid =
    (provider !== "container" || acknowledged) &&
    Number.isSafeInteger(Number(idle)) &&
    Number(idle) >= 1 &&
    Number(idle) <= 1440 &&
    (quota === "" ||
      (Number.isSafeInteger(Number(quota)) && Number(quota) > 0));

  function load(settings: SandboxSettings) {
    setSaved(settings);
    setProvider(settings.provider);
    setAcknowledged(settings.hostNetworkAcknowledged);
    setIdle(String(settings.idleMinutes));
    setQuota(
      settings.diskQuotaMiB === null ? "" : String(settings.diskQuotaMiB),
    );
    setError("");
    setMessage("");
  }

  useEffect(() => {
    if (changedElsewhere && !dirty && !pending) load(info.settings);
  }, [changedElsewhere, dirty, pending, info.settings]);

  async function save() {
    if (!valid || changedElsewhere || pending) return;
    setError("");
    setMessage("");
    try {
      const updated = await onSave({
        provider,
        hostNetworkAcknowledged: acknowledged,
        idleMinutes: Number(idle),
        diskQuotaMiB: quota === "" ? null : Number(quota),
        revision: saved.revision,
      });
      load(updated);
      setMessage(`Saved revision ${updated.revision}.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save sandbox settings.",
      );
    }
  }

  return (
    <form
      className="sandbox-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Group
        title="Sandbox settings"
        note="Saved for this bot across restarts. Providers keep separate files; switching does not move or delete them."
      >
        <Row
          title="Provider"
          description="Choose the provider for this bot’s workspace."
        >
          <div className="sandbox-control">
            <Select
              value={provider}
              onValueChange={(value) => {
                if (value) setProvider(value as SandboxProvider);
              }}
              disabled={pending}
            >
              <SelectTrigger aria-label="Sandbox provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {info.providers.map((entry) => (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}
                    disabled={!entry.available}
                  >
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Row>
        {info.providers
          .filter((entry) => !entry.available)
          .map((entry) => (
            <Row
              key={entry.id}
              title={`${entry.name} · Unavailable`}
              description={entry.reason}
            />
          ))}
        {(provider === "container" || acknowledged) && (
          <Row
            title="I understand host and local network access"
            description={
              <span id="sandbox-host-network-description">
                Required before enabling Container. Container programs can reach
                services on this machine and the local network, including
                Raphie’s API. This acknowledgement allows that access for this
                bot; it does not block traffic. Host credentials are not
                provided. To withdraw acknowledgement, select just-bash, turn
                this off and save.
              </span>
            }
          >
            <Switch
              id="sandbox-host-network"
              aria-label="Acknowledge host and local network access"
              aria-describedby="sandbox-host-network-description"
              aria-required={provider === "container"}
              checked={acknowledged}
              onCheckedChange={setAcknowledged}
              disabled={pending}
            />
          </Row>
        )}
        <Row
          title="Idle minutes"
          description={
            <>
              <label htmlFor="sandbox-idle">
                Applies to the container provider
              </label>
              . Stops the container after 1–1440 idle minutes. Has no effect on
              just-bash.
            </>
          }
        >
          <div className="sandbox-control">
            <Input
              id="sandbox-idle"
              aria-label="Idle minutes"
              type="number"
              min={1}
              max={1440}
              step={1}
              required
              value={idle}
              onChange={(event) => setIdle(event.target.value)}
              disabled={pending}
            />
          </div>
        </Row>
        <Row
          title="Disk quota (MiB)"
          description={
            <>
              <label htmlFor="sandbox-quota">
                Applies to the container provider
              </label>
              . Leave empty for no limit (the default). Has no effect on
              just-bash.
            </>
          }
        >
          <div className="sandbox-control">
            <Input
              id="sandbox-quota"
              aria-label="Disk quota (MiB)"
              type="number"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              placeholder="No limit"
              value={quota}
              onChange={(event) => setQuota(event.target.value)}
              disabled={pending}
            />
          </div>
        </Row>
      </Group>
      <SaveBar
        visible={dirty || pending || !!message || !!error || !!guard.message}
        status={guard.message || (dirty ? "Unsaved changes" : message)}
        error={
          changedElsewhere && dirty
            ? "Sandbox settings changed elsewhere. Your draft is preserved. Copy any edits you want to keep, then Discard to load the latest revision."
            : error
        }
        pending={pending}
        canSave={dirty && valid && !changedElsewhere}
        canDiscard={dirty}
        onDiscard={() => load(info.settings)}
      />
    </form>
  );
}
