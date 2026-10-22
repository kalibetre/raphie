export type MemoryProvider = "builtin" | "hindsight";

export type MemoryConfiguration = {
  enabled: boolean;
  provider: MemoryProvider;
  /** Runtime-owned namespace; shared across this owner's sessions. */
  scope: string;
  endpoint: string;
  bankId: string;
  hasCredential: boolean;
};

export type SaveMemoryConfiguration = Omit<
  MemoryConfiguration,
  "hasCredential"
> & {
  /** Omission preserves the existing credential; null clears it. */
  apiKey?: string | null;
};

export type MemoryEvidence = {
  id: string;
  content: string;
  kind: "fact" | "experience";
  source: string;
  eventTime: number;
  revision: number;
};

export type MemoryRecall = { evidence: MemoryEvidence[] };

export type MemoryReflection = MemoryRecall & {
  answer: string;
  mode: "model-assisted" | "provider";
};

export type MemoryStatus = {
  configuration: MemoryConfiguration;
  capabilities: {
    retain: boolean;
    recall: boolean;
    reflect: "model-assisted" | "provider";
    revise: boolean;
    forget: boolean;
    consolidation: "none" | "provider";
  };
  error: string | null;
};
