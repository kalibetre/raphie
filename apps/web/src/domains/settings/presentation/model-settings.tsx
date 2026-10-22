import { useState } from "react";

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
      <Group title="Model list">
        <div className="settings-form">
          <p>
            {data.models.length} models available. The model list and pricing
            are supplied by Pi and updated with Pi releases.
          </p>
        </div>
      </Group>
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
          <Input
            id="model-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or model ID"
          />
          <label htmlFor="default-model">Default model</label>
          <Select
            value={selected}
            onValueChange={(value) => {
              setModel(value);
              setMessage("");
              settings.update.reset();
            }}
          >
            <SelectTrigger id="default-model" aria-label="Default model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!data.models.some((m) => m.id === selected) && (
                <SelectItem value={selected}>
                  {selected} · unavailable
                </SelectItem>
              )}
              {catalog.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name} · {m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
