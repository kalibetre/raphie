import type { RuntimeSettings } from "@raphie/contracts";
import { X } from "lucide-react";
import { useState } from "react";

import { api } from "../../../infrastructure/http/api-client";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../shared/ui/select";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { Group } from "./settings-group";

export function ProviderConnection({
  settings,
  onClose,
}: {
  settings: RuntimeSettings;
  onClose: () => void;
}) {
  const { update } = useRuntimeSettings();
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const busy = testing || update.isPending;
  const configured = !!settings.credentialSource;

  async function testConnection() {
    setTesting(true);
    setMessage("");
    update.reset();
    try {
      await api("/api/settings/provider/test", key ? { apiKey: key } : {});
      setMessage("OpenRouter connection successful.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Group
      title="Connect a provider"
      note="Choose a provider, then add its connection details."
    >
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          update.mutate(
            {
              provider: settings.provider,
              providerEnabled: true,
              ...(key ? { apiKey: key } : {}),
            },
            {
              onSuccess: () => {
                setKey("");
                onClose();
              },
            },
          );
        }}
      >
        <div className="provider-setup-heading">
          <label htmlFor="model-provider">Provider</label>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close provider setup"
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <Select value={settings.provider} disabled={busy}>
          <SelectTrigger id="model-provider" aria-label="Provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {settings.providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label htmlFor="provider-api-key">OpenRouter API key</label>
        <Input
          id="provider-api-key"
          name="openrouter-key"
          type="password"
          autoComplete="new-password"
          value={key}
          disabled={busy}
          onChange={(event) => {
            setKey(event.target.value);
            setMessage("");
            update.reset();
          }}
          placeholder={
            configured ? "Enter a replacement key" : "Enter an API key"
          }
          spellCheck={false}
          aria-describedby="provider-key-help"
        />
        <p id="provider-key-help">
          Your key stays on the backend.{" "}
          {configured
            ? "Leave blank to keep the configured key."
            : "The connection is verified before it is saved."}
        </p>
        <div className="settings-actions">
          <Button type="submit" disabled={busy || (!key && !configured)}>
            {update.isPending ? "Connecting…" : "Connect provider"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || (!key && !configured)}
            onClick={() => void testConnection()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
        {(message || update.error) && (
          <p role="status">{update.error?.message ?? message}</p>
        )}
      </form>
    </Group>
  );
}
