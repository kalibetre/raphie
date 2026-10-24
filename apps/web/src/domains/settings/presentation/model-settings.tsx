import { useNavigate } from "@tanstack/react-router";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { filterModels, modelSource } from "../application/model-library";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { ModelCard } from "./model-card";
import { ModelFilters } from "./model-filters";
import { SettingsStatus } from "./settings-status";

const PAGE_SIZE = 24;

export function ModelSettings() {
  const settings = useRuntimeSettings();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [source, setSource] = useState("all");
  const [connection, setConnection] = useState("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [message, setMessage] = useState("");
  const data = settings.data;
  if (!data)
    return (
      <SettingsStatus
        title="Models"
        message={
          settings.error
            ? "Could not load models. Check your backend connection."
            : "Loading models…"
        }
        onRetry={settings.error ? () => void settings.refetch() : undefined}
      />
    );

  if (!data.connections.length)
    return (
      <SettingsStatus
        title="Connect a provider"
        message="Add a provider connection for this bot to see available models."
        action="Configure providers"
        onRetry={() =>
          void navigate({
            to: ".",
            search: (previous) => ({
              ...previous,
              view: "settings",
              section: "providers",
            }),
          })
        }
      />
    );

  const sources = [
    ...new Map(
      data.models.map((model) => {
        const source = modelSource(model);
        return [source.id, source] as const;
      }),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const matching = filterModels(data.models, search, provider, source).filter(
    (model) => connection === "all" || model.connectionId === connection,
  );
  const defaultModel = data.models.find(
    (model) =>
      model.id === data.modelId && model.connectionId === data.provider,
  );
  const filtered =
    search !== "" ||
    provider !== "all" ||
    source !== "all" ||
    connection !== "all";

  function clear() {
    setSearch("");
    setProvider("all");
    setSource("all");
    setConnection("all");
    setLimit(PAGE_SIZE);
  }

  return (
    <>
      <div className="model-default-summary">
        <span className="model-default-icon">
          <SlidersHorizontal size={18} />
        </span>
        <div>
          <span>Default for new sessions</span>
          <strong>
            {defaultModel?.name ?? `${data.modelId} · unavailable`}
          </strong>
          <p>
            {defaultModel?.connectionName ?? "No connection"} · Existing
            sessions keep their model.
          </p>
        </div>
      </div>
      <ModelFilters
        search={search}
        provider={provider}
        source={source}
        providers={data.providers}
        sources={sources}
        connections={data.connections}
        connection={connection}
        onConnection={(value) => {
          setConnection(value);
          setLimit(PAGE_SIZE);
        }}
        onSearch={(value) => {
          setSearch(value);
          setLimit(PAGE_SIZE);
        }}
        onProvider={(value) => {
          setProvider(value);
          setLimit(PAGE_SIZE);
        }}
        onSource={(value) => {
          setSource(value);
          setLimit(PAGE_SIZE);
        }}
      />
      <div className="model-results-summary">
        <p role="status">
          {matching.length} {matching.length === 1 ? "model" : "models"}
          {filtered ? " match your filters" : " available"}
        </p>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X />
            Clear filters
          </Button>
        )}
      </div>
      {(message || settings.update.error) && (
        <p role="status" className="catalog-feedback">
          {settings.update.error?.message ?? message}
        </p>
      )}
      {matching.length ? (
        <>
          <div className="model-library-grid">
            {matching.slice(0, limit).map((model) => (
              <ModelCard
                key={`${model.connectionId}:${model.id}`}
                model={model}
                providerName={
                  data.providers.find((p) => p.id === model.provider)?.name ??
                  model.provider
                }
                isDefault={
                  model.id === data.modelId &&
                  model.connectionId === data.provider
                }
                saving={settings.update.isPending}
                onSelect={() => {
                  setMessage("");
                  settings.update.mutate(
                    {
                      modelId: model.id,
                      connectionId: model.connectionId,
                    },
                    {
                      onSuccess: () =>
                        setMessage(
                          `${model.name} is now the default for new sessions.`,
                        ),
                    },
                  );
                }}
              />
            ))}
          </div>
          {matching.length > limit && (
            <div className="model-load-more">
              <p>
                Showing {Math.min(limit, matching.length)} of {matching.length}{" "}
                models
              </p>
              <Button
                variant="outline"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
              >
                Show more models
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="catalog-empty">
          <Search size={24} />
          <h3>No models found</h3>
          <p>Try a different name, provider, or model source.</p>
          <Button variant="outline" onClick={clear}>
            Clear filters
          </Button>
        </div>
      )}
      <p className="catalog-footnote">
        Model definitions and estimated prices come from Pi’s catalog. Prices
        are in USD per million tokens; your provider’s billing applies.
      </p>
    </>
  );
}
