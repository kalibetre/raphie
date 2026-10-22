import type { MutableModels, Provider } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";

export type StoredConnection = {
  id: string;
  provider: "openrouter";
  name: string;
  apiKey: string | null;
  environment: boolean;
  enabled: boolean;
};

/** Each connection is a distinct Pi provider instance with its own auth resolver. */
export class PiProviderConnections {
  readonly provider: Provider;
  private registered = new Set<string>();
  private models: MutableModels;
  private environmentKey?: string;

  constructor(models: MutableModels, environmentKey?: string) {
    this.models = models;
    this.environmentKey = environmentKey;
    const provider = models.getProvider("openrouter") ?? openrouterProvider();
    this.provider = provider;
    this.registered.add(provider.id);
    for (const existing of models.getProviders()) {
      if (existing.id.startsWith("openrouter_"))
        this.registered.add(existing.id);
    }
  }

  key(connection: StoredConnection) {
    return (
      connection.apiKey ??
      (connection.environment ? this.environmentKey : undefined)
    );
  }

  publish(connections: StoredConnection[]) {
    for (const id of this.registered) this.models.deleteProvider(id);
    this.registered.clear();
    for (const connection of connections) {
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
