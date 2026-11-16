/** How a connection authenticates: an API key, or a subscription sign-in. */
export type ConnectionAuth = "api_key" | "subscription";

export type ProviderConnection = {
  id: string;
  provider: string;
  name: string;
  credentialSource: "saved";
  /** Absent from older runtimes, which only had API keys. */
  auth?: ConnectionAuth;
  /** A subscription whose sign-in expired and could not be renewed. */
  needsSignIn?: boolean;
};

/** A provider a connection can be made to, and how. */
export type ConnectionProvider = {
  id: string;
  name: string;
  /** Absent from older runtimes: API keys only. */
  auth?: ConnectionAuth[];
  /** The subscription sign-in's button label, e.g. "Sign in with ChatGPT". */
  signInLabel?: string;
};

/** What a provider's sign-in asks the owner for. */
export type SignInPrompt = {
  /** Answer with this id, so a stale answer cannot reach a newer question. */
  id: string;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
};

/** What a provider's sign-in reports along the way. */
export type SignInEvent =
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      expiresInSeconds?: number;
    }
  | { type: "progress" | "info"; message: string };

/** One subscription sign-in in progress or finished. */
export type ProviderSignIn = {
  id: string;
  provider: string;
  name: string;
  status: "waiting" | "connected" | "failed" | "cancelled";
  /** Oldest first. */
  events: SignInEvent[];
  /** The question waiting for an answer, if any. */
  prompt?: SignInPrompt;
  error?: string;
  /** The connection made or renewed, once connected. */
  connectionId?: string;
};

export type StartProviderSignIn = {
  provider: string;
  name: string;
  /** Renew this connection's sign-in instead of adding a connection. */
  connectionId?: string;
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
  credentialSource: "saved" | null;
  modelId: string;
  providers: ConnectionProvider[];
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
