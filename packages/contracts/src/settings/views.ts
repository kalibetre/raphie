export type RuntimeSettings = {
  telemetryEnabled: boolean;
  provider: string;
  providerEnabled: boolean;
  credentialSource: "saved" | "environment" | null;
  modelId: string;
  providers: { id: string; name: string }[];
  models: {
    id: string;
    name: string;
    contextWindow: number;
    /** USD per million tokens, from OpenRouter when known. */
    pricing?: { input: number; output: number };
  }[];
  /** Where `models` came from: OpenRouter's cached list, or Pi's bundled one. */
  modelCatalog: { source: "openrouter" | "bundled"; fetchedAt: number | null };
};

export type UpdateRuntimeSettings = {
  telemetryEnabled?: boolean;
  provider?: string;
  providerEnabled?: boolean;
  modelId?: string;
  apiKey?: string | null;
};
