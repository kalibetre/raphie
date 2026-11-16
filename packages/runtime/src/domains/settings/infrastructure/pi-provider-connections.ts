import type {
  Credential,
  ModelAuth,
  OAuthCredential,
} from "@earendil-works/pi-ai";
import type { MutableModels, Provider } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";

/** Every model a provider lists (Pi does not export the type by name). */
type ProviderModels = ReturnType<NonNullable<Provider["getAllModels"]>>;

export type StoredConnection = {
  id: string;
  /** Pi's provider id: "openrouter", or a subscription such as "openai". */
  provider: string;
  name: string;
  /** Absent in settings written before subscriptions: an API key. */
  auth?: "api_key" | "oauth";
  apiKey: string | null;
  /** A subscription's tokens, refreshed and saved as they rotate. */
  oauth?: OAuthCredential | null;
  enabled: boolean;
};

/** Whether `connection` has what it needs to make requests. */
export function connectionReady(connection: StoredConnection) {
  return connection.auth === "oauth" ? !!connection.oauth : !!connection.apiKey;
}

/** How request auth is found for a subscription connection. */
export type SubscriptionAuth = (connectionId: string) => Promise<ModelAuth>;

/** Each connection is a distinct Pi provider instance with its own auth resolver. */
export class PiProviderConnections {
  readonly provider: Provider;
  private registered = new Set<string>();
  private models: MutableModels;

  constructor(models: MutableModels) {
    this.models = models;
    const provider = models.getProvider("openrouter") ?? openrouterProvider();
    this.provider = provider;
    this.registered.add(provider.id);
    for (const existing of models.getProviders()) {
      if (existing.id.startsWith("openrouter_"))
        this.registered.add(existing.id);
    }
  }

  key(connection: StoredConnection) {
    return connection.auth === "oauth"
      ? undefined
      : (connection.apiKey ?? undefined);
  }

  /**
   * The chat models a connection offers. A subscription sees what Pi lets
   * its tokens reach (Sign in with ChatGPT has no classifier models).
   */
  static chatModels(stock: Provider, connection: StoredConnection) {
    const credential: Credential | undefined =
      connection.auth === "oauth" && connection.oauth
        ? connection.oauth
        : undefined;
    const models = stock.getModels();
    return credential && stock.filterModels
      ? stock.filterModels(models, credential)
      : models;
  }

  private static allModels(
    stock: Provider,
    connection: StoredConnection,
  ): ProviderModels {
    const models = stock.getAllModels?.() ?? stock.getModels();
    const credential =
      connection.auth === "oauth" && connection.oauth
        ? connection.oauth
        : undefined;
    return credential && stock.filterAllModels
      ? stock.filterAllModels(models, credential)
      : models;
  }

  /**
   * Registers one Pi provider per ready connection. `stockFor` finds the
   * subscription providers; `subscriptionAuth` resolves their tokens.
   */
  publish(
    connections: StoredConnection[],
    stockFor: (providerId: string) => Provider | undefined = () => undefined,
    subscriptionAuth?: SubscriptionAuth,
  ) {
    for (const id of this.registered) this.models.deleteProvider(id);
    this.registered.clear();
    for (const connection of connections) {
      if (connection.auth === "oauth") {
        const stock = stockFor(connection.provider);
        if (!connection.enabled || !connection.oauth || !stock) continue;
        if (!subscriptionAuth) continue;
        this.models.setProvider({
          ...stock,
          id: connection.id,
          name: connection.name,
          getModels: () =>
            PiProviderConnections.chatModels(stock, connection).map((m) => ({
              ...m,
              provider: connection.id,
            })),
          getAllModels: () =>
            PiProviderConnections.allModels(stock, connection).map((m) => ({
              ...m,
              provider: connection.id,
            })),
          auth: {
            apiKey: {
              name: `${connection.name} subscription`,
              resolve: async () => ({
                auth: await subscriptionAuth(connection.id),
                source: "OAuth",
              }),
            },
          },
        });
        this.registered.add(connection.id);
        continue;
      }
      const key = this.key(connection);
      if (key) registerRedactionSecret(key);
      if (!connection.enabled || !key) continue;
      const stock = this.provider;
      this.models.setProvider({
        ...stock,
        id: connection.id,
        name: connection.name,
        getModels: () =>
          stock.getModels().map((m) => ({ ...m, provider: connection.id })),
        getAllModels: () =>
          (stock.getAllModels?.() ?? stock.getModels()).map((m) => ({
            ...m,
            provider: connection.id,
          })),
        auth: {
          apiKey: {
            name: `${connection.name} API key`,
            resolve: async () => ({ auth: { apiKey: key } }),
          },
        },
      });
      this.registered.add(connection.id);
    }
  }
}
