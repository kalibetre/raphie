import type { ConnectionProvider } from "@raphie/contracts";
import { ArrowRight, KeyRound, LogIn } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { useRuntimeSettings } from "../infrastructure/use-runtime-settings";
import { BotAvatar } from "./bot-avatar";
import { ProviderConnection } from "./provider-connection";

/** True once the bot's settings say it has no model it can reply with. */
export function useNeedsSetup() {
  const settings = useRuntimeSettings();
  return !!settings.data && !settings.data.models.length;
}

const how = (provider: ConnectionProvider) =>
  provider.auth?.includes("subscription")
    ? (provider.signInLabel ?? "Sign in with your plan")
    : "Paste an API key";

/**
 * A bot without a model introduces itself and asks for one, in place of the
 * empty conversation and its composer: it cannot reply until it has one.
 */
export function BotSetup({
  botId,
  name,
  onProviders,
}: {
  botId: string;
  name: string;
  /** Opens this bot's provider settings. */
  onProviders: () => void;
}) {
  const settings = useRuntimeSettings();
  const [chosen, setChosen] = useState<string>();
  const data = settings.data;
  if (!data) return null;
  // A connection that gives no models, such as an expired sign-in, is
  // fixed where connections are managed.
  const broken = data.connections.length > 0;
  const providers = chosen
    ? [
        ...data.providers.filter((p) => p.id === chosen),
        ...data.providers.filter((p) => p.id !== chosen),
      ]
    : data.providers;
  const suggestName = (provider: string) =>
    `${data.providers.find((p) => p.id === provider)?.name ?? provider} ${
      data.connections.filter((c) => c.provider === provider).length + 1
    }`;
  return (
    <section className="bot-setup" aria-labelledby="bot-setup-title">
      <div className="bot-setup-avatar">
        <BotAvatar id={botId} />
      </div>
      <h2 id="bot-setup-title">
        {broken
          ? `${name}’s connection needs attention.`
          : "First, I need a way to think."}
      </h2>
      <p>
        {broken
          ? `None of ${name}’s connections offers a model right now. Check them in Settings.`
          : `Connect one model service and ${name} can start. It belongs to ${name} only; you can add more later in Settings.`}
      </p>
      {broken ? (
        <Button onClick={onProviders}>
          Open {name}’s providers
          <ArrowRight />
        </Button>
      ) : chosen ? (
        <div className="bot-setup-form">
          <ProviderConnection
            providers={providers}
            suggestedName={suggestName(chosen)}
            suggestName={suggestName}
            onClose={() => setChosen(undefined)}
          />
        </div>
      ) : (
        <div
          className="bot-setup-options"
          role="group"
          aria-label="Model services"
        >
          {data.providers.map((provider) => {
            const subscription = provider.auth?.includes("subscription");
            return (
              <button
                key={provider.id}
                className="bot-setup-option"
                onClick={() => setChosen(provider.id)}
              >
                {subscription ? (
                  <LogIn size={16} aria-hidden="true" />
                ) : (
                  <KeyRound size={16} aria-hidden="true" />
                )}
                <span>
                  <strong>{provider.name}</strong>
                  <small>{how(provider)}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
