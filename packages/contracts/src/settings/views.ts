export type ProviderConnection = {
  id: string;
  provider: string;
  name: string;
  credentialSource: "saved" | "environment";
};

export type SaveProviderConnection = {
  provider: string;
  name: string;
  apiKey: string;
};

export type EditProviderConnection = {
  name: string;
  apiKey?: string;
};

export type RuntimeSettings = {
  telemetryEnabled: boolean;
  /** Pi connection identity used for the default model. */
  provider: string;
  providerEnabled: boolean;
  credentialSource: "saved" | "environment" | null;
  modelId: string;
  providers: { id: string; name: string }[];
  connections: ProviderConnection[];
  models: {
    id: string;
    name: string;
    /** Provider service, such as OpenRouter; connectionId selects its credentials. */
    provider: string;
    connectionId: string;
    connectionName: string;
    contextWindow: number;
    maxOutputTokens: number;
    reasoning: boolean;
    inputModalities: string[];
    /** USD per million tokens, from Pi's model catalog when known. */
    pricing?: { input: number; output: number };
  }[];
};

export type UpdateRuntimeSettings = {
  connectionId?: string;
  telemetryEnabled?: boolean;
  provider?: string;
  providerEnabled?: boolean;
  modelId?: string;
  apiKey?: string | null;
};
