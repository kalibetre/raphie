import type { RuntimeSettings } from "@raphie/contracts";
import { useState } from "react";

import { api } from "../../../infrastructure/http/api-client";
import { Button } from "../../../shared/ui/button";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { Group } from "./settings-group";

export function ProviderConnection({
  settings,
}: {
  settings: RuntimeSettings;
}) {
  const { update } = useRuntimeSettings();
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const busy = testing || update.isPending;
  const configured = !!settings.credentialSource;
  const source =
    settings.credentialSource === "environment"
      ? "environment key"
      : "saved key";

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

  function save(input: Parameters<typeof update.mutate>[0], success: string) {
    setMessage("");
    update.mutate(input, {
      onSuccess: () => {
        setKey("");
        setMessage(success);
      },
    });
  }

  return (
    <Group
      title="Provider connection"
      note="OpenRouter is the first supported model provider."
    >
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          save(
            {
              provider: settings.provider,
              providerEnabled: true,
              ...(key ? { apiKey: key } : {}),
            },
            "Provider connection saved.",
          );
        }}
      >
        <label htmlFor="model-provider">Provider</label>
        <select
          id="model-provider"
          value={settings.provider}
          onChange={() => {}}
          disabled={busy}
        >
          {settings.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p>
          {settings.providerEnabled && configured
            ? `Configured with ${source}.`
            : "Disconnected."}
        </p>
        <label htmlFor="provider-api-key">OpenRouter API key</label>
        <input
          id="provider-api-key"
          name="openrouter-key"
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setMessage("");
            update.reset();
          }}
          placeholder={
            configured ? "Enter a replacement key" : "Enter an API key"
          }
          spellCheck={false}
        />
        <p>
          Keys stay on the backend and are never returned here. Leave blank to
          keep the configured key.
        </p>
        <div className="settings-actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy || (!key && !configured)}
            onClick={() => void testConnection()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button type="submit" disabled={busy || (!key && !configured)}>
            {update.isPending ? "Saving…" : "Save connection"}
          </Button>
          {settings.providerEnabled && configured && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                save(
                  { providerEnabled: false },
                  "Provider disconnected. No new model turns will start.",
                )
              }
            >
              Disconnect
            </Button>
          )}
          {settings.credentialSource === "saved" && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                save(
                  { apiKey: null },
                  "Saved key removed. The backend’s environment key is used if configured.",
                )
              }
            >
              Remove saved key
            </Button>
          )}
        </div>
        {(message || update.error) && (
          <p role="status">{update.error?.message ?? message}</p>
        )}
      </form>
    </Group>
  );
}
