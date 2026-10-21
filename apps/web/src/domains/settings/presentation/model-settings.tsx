import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { ProviderConnection } from "./provider-connection";
import { Group } from "./settings-group";

export function ModelSettings() {
  const settings = useRuntimeSettings();
  const [model, setModel] = useState<string>();
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const data = settings.data;
  if (!data)
    return (
      <Group title="Models">
        <div className="settings-form">
          <p role="status">
            {settings.error
              ? "Could not load backend settings. Check your backend connection."
              : "Loading model settings…"}
          </p>
          <Button variant="outline" onClick={() => void settings.refetch()}>
            Retry
          </Button>
        </div>
      </Group>
    );
  const selected = model ?? data.modelId;
  const catalog = data.models.filter(
    (m) =>
      m.id === selected ||
      `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <ProviderConnection settings={data} />
      <Group
        title="Default for new sessions"
        note="New sessions start with this model. Existing sessions keep their model; choose a different one in the composer."
      >
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage("");
            settings.update.mutate(
              { modelId: selected },
              {
                onSuccess: () => {
                  setModel(undefined);
                  setMessage("Default model saved.");
                },
              },
            );
          }}
        >
          <label htmlFor="model-search">Find a model</label>
          <input
            id="model-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or model ID"
          />
          <label htmlFor="default-model">Default model</label>
          <select
            id="default-model"
            value={selected}
            onChange={(event) => {
              setModel(event.target.value);
              setMessage("");
              settings.update.reset();
            }}
          >
            {!data.models.some((m) => m.id === selected) && (
              <option value={selected}>{selected} · unavailable</option>
            )}
            {catalog.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.id}
              </option>
            ))}
          </select>
          <p>
            {catalog.length} models shown
            {data.models.find((m) => m.id === selected)?.contextWindow
              ? ` · ${data.models.find((m) => m.id === selected)!.contextWindow.toLocaleString()} token context`
              : ""}
            . Saving does not start a model request.
          </p>
          <div className="settings-actions">
            <Button
              type="submit"
              disabled={settings.update.isPending || selected === data.modelId}
            >
              {settings.update.isPending ? "Saving…" : "Save model"}
            </Button>
          </div>
          {(message || settings.update.error) && (
            <p role="status">{settings.update.error?.message ?? message}</p>
          )}
        </form>
      </Group>
    </>
  );
}
