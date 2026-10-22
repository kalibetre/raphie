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
    /** USD per million tokens, from Pi's model catalog when known. */
    pricing?: { input: number; output: number };
  }[];
};

export type UpdateRuntimeSettings = {
  telemetryEnabled?: boolean;
  provider?: string;
  providerEnabled?: boolean;
  modelId?: string;
  apiKey?: string | null;
};
