import { useIsMutating } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { useProviderConnections } from "../infrastructure/use-provider-connections";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { ProviderCard } from "./provider-card";
import { ProviderConnection } from "./provider-connection";
import { SettingsStatus } from "./settings-status";

export function ProviderSettings() {
  const settings = useRuntimeSettings();
  const mutation = useProviderConnections();
  const busy = useIsMutating({ mutationKey: ["provider-connections"] }) > 0;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const data = settings.data;
  if (!data)
    return (
      <SettingsStatus
        title="Connections"
        message={
          settings.error ? "Could not load providers." : "Loading providers…"
        }
        onRetry={settings.error ? () => void settings.refetch() : undefined}
      />
    );

  function add() {
    setAdding(true);
    setMessage("");
    mutation.reset();
  }

  return (
    <>
      <div className="settings-toolbar">
        <p>
          {data.connections.length
            ? `${data.connections.length} ${data.connections.length === 1 ? "connection" : "connections"} · name each one, and connect a provider more than once if you need to.`
            : "Name each connection. You can connect the same provider more than once."}
        </p>
        <Button onClick={add} disabled={adding || busy}>
          <Plus />
          Add connection
        </Button>
      </div>
      {adding && (
        <ProviderConnection
          providers={data.providers}
          suggestedName={`OpenRouter ${data.connections.filter((c) => c.provider === "openrouter").length + 1}`}
          onClose={() => {
            setAdding(false);
            setMessage("");
          }}
        />
      )}
      {data.connections.map((connection) =>
        editing.includes(connection.id) ? (
          <ProviderConnection
            key={connection.id}
            connection={connection}
            providers={data.providers}
            suggestedName={connection.name}
            onClose={() => {
              setEditing((current) =>
                current.filter((id) => id !== connection.id),
              );
              setMessage("");
            }}
          />
        ) : (
          <ProviderCard
            key={connection.id}
            connection={connection}
            providerName={
              data.providers.find((p) => p.id === connection.provider)?.name ??
              connection.provider
            }
            modelCount={
              data.models.filter((m) => m.connectionId === connection.id).length
            }
            busy={busy}
            onEdit={() => {
              setEditing((current) => [...current, connection.id]);
              setMessage("");
              mutation.reset();
            }}
            onRemove={() => {
              setMessage("");
              mutation.mutate(
                { action: "remove", id: connection.id },
                {
                  onSuccess: () =>
                    setMessage(
                      `${connection.name} removed. Other connections are unchanged.`,
                    ),
                },
              );
            }}
          />
        ),
      )}
      {!data.connections.length && !adding && (
        <div className="catalog-empty">
          <KeyRound size={24} />
          <h3>No providers connected</h3>
          <p>
            Add a connection to start using models. Your conversations stay here
            when a connection is removed.
          </p>
          <Button variant="outline" onClick={add}>
            <Plus />
            Add your first connection
          </Button>
        </div>
      )}
      {(message || mutation.error) && (
        <p role="status" className="catalog-feedback">
          {mutation.error?.message ?? message}
        </p>
      )}
    </>
  );
}
