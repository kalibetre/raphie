import { Check, KeyRound, Plus, ArrowUpRight, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { ProviderConnection } from "./provider-connection";
import { Group } from "./settings-group";

export function ProviderSettings() {
  const settings = useRuntimeSettings();
  const [setup, setSetup] = useState(false);
  const [message, setMessage] = useState("");
  const data = settings.data;
  if (!data)
    return (
      <Group title="Providers">
        <div className="settings-form">
          <p role="status">
            {settings.error
              ? "Could not load providers."
              : "Loading providers…"}
          </p>
          <Button variant="outline" onClick={() => void settings.refetch()}>
            Retry
          </Button>
        </div>
      </Group>
    );
  const connected = data.providerEnabled && !!data.credentialSource;
  return (
    <>
      <header className="catalog-heading">
        <div>
          <h2>Your providers</h2>
          <p>Connect the services your models run through.</p>
        </div>
        <Button
          onClick={() => {
            setSetup(true);
            setMessage("");
          }}
          disabled={setup}
        >
          <Plus />
          {connected ? "Manage connection" : "Add provider"}
        </Button>
      </header>
      {connected ? (
        <article className="provider-card">
          <div className="provider-card-heading">
            <span className="provider-mark">
              <ArrowUpRight size={22} />
            </span>
            <div>
              <h3>OpenRouter</h3>
              <p>One connection, models from many sources.</p>
            </div>
            <span className="catalog-badge connected">
              <Check size={12} />
              Connected
            </span>
          </div>
          <div className="provider-card-details">
            <span>
              <KeyRound size={14} />
              {data.credentialSource === "environment"
                ? "Backend environment key"
                : "Saved API key"}
            </span>
            <span>{data.models.length} models</span>
          </div>
          <footer>
            <Button variant="outline" size="sm" onClick={() => setSetup(true)}>
              Edit connection
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={settings.update.isPending}
              onClick={() => {
                setMessage("");
                settings.update.mutate(
                  { apiKey: null, providerEnabled: false },
                  {
                    onSuccess: () => {
                      setSetup(false);
                      setMessage(
                        "Provider removed. New turns are disabled until you connect a provider.",
                      );
                    },
                  },
                );
              }}
            >
              <Trash2 />
              {settings.update.isPending ? "Removing…" : "Remove provider"}
            </Button>
          </footer>
          {data.credentialSource === "environment" && (
            <p className="provider-environment-note">
              Removing disconnects this provider. The environment key remains on
              your backend.
            </p>
          )}
        </article>
      ) : (
        !setup && (
          <div className="catalog-empty">
            <KeyRound size={24} />
            <h3>No providers connected</h3>
            <p>
              Add a provider to start using models. Your conversations stay here
              when a provider is removed.
            </p>
            <Button variant="outline" onClick={() => setSetup(true)}>
              <Plus />
              Add your first provider
            </Button>
          </div>
        )
      )}
      {setup && (
        <ProviderConnection settings={data} onClose={() => setSetup(false)} />
      )}
      {(message || settings.update.error) && (
        <p role="status" className="catalog-feedback">
          {settings.update.error?.message ?? message}
        </p>
      )}
    </>
  );
}
