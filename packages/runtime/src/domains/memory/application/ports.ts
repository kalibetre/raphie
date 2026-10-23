import type {
  MemoryEvidence,
  MemoryPage,
  MemoryRecall,
  MemoryReflection,
  MemoryStatus,
  SaveMemoryConfiguration,
} from "@raphie/contracts";

import type { EncryptedCredential } from "../../../shared/application/encrypted-credential.ts";

export type RetainMemory = Omit<MemoryEvidence, "revision">;

/** Scope is supplied by the runtime configuration, never by a model/tool caller. */
export interface MemoryBackend {
  browse?(scope: string, after?: string): Promise<MemoryPage>;
  retain(scope: string, input: RetainMemory): Promise<void>;
  recall(scope: string, query: string): Promise<MemoryRecall>;
  revise(scope: string, id: string, content: string): Promise<void>;
  forget(scope: string, id: string): Promise<void>;
  reflect?(scope: string, query: string): Promise<MemoryReflection>;
  test(): Promise<void>;
}

export interface MemoryService {
  browse(after?: string): Promise<MemoryPage>;
  read(): MemoryStatus;
  configure(input: SaveMemoryConfiguration): Promise<MemoryStatus>;
  test(): Promise<void>;
  retain(input: RetainMemory): Promise<void>;
  recall(query: string): Promise<MemoryRecall>;
  reflect(query: string): Promise<MemoryReflection>;
  revise(id: string, content: string): Promise<void>;
  forget(id: string): Promise<void>;
}

/** The host resolves the active turn; model arguments cannot supply provenance. */
export type TurnProvenance = (conversationId: number) => Promise<{
  sessionId: string;
  turnId: string;
  eventTime: number;
} | null>;

export interface MemoryCredentials {
  sealMemoryKey(value: string | null): EncryptedCredential | null;
  openMemoryKey(value: EncryptedCredential | null): string | null;
}
