import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  MemoryConfiguration,
  MemoryStatus,
  SaveMemoryConfiguration,
} from "@raphie/contracts";
import { z } from "zod";

import type { EncryptedCredential } from "../../../shared/application/encrypted-credential.ts";
import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { registerRedactionSecret } from "../../../shared/infrastructure/redaction.ts";
import type {
  MemoryBackend,
  MemoryCredentials,
  MemoryService,
  RetainMemory,
} from "../application/ports.ts";
import { BuiltinMemory } from "./builtin-memory.ts";
import { HindsightMemory } from "./hindsight-memory.ts";

export const memoryConfigurationInput = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(["builtin", "hindsight"]),
    scope: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/),
    endpoint: z.string().trim().max(2048),
    bankId: z.string().trim().max(80),
    apiKey: z.string().min(1).max(4096).regex(/^\S+$/).nullable().optional(),
  })
  .strict();

const contentInput = z.string().trim().min(1).max(8000);
const idInput = z.string().min(1).max(256);
const queryInput = z.string().trim().min(1).max(2000);

type Destination = { endpoint: string; bankId: string };

type Saved = Omit<MemoryConfiguration, "hasCredential"> & {
  credential: EncryptedCredential | null;
  // The Hindsight destination the key was saved for. A key is only ever sent
  // there, so no configuration sequence can redirect it to another host.
  credentialFor?: Destination;
};

const sameDestination = (a: Destination, b: Destination | undefined) =>
  !!b && a.endpoint === b.endpoint && a.bankId === b.bankId;

export class RuntimeMemory implements MemoryService {
  private db: Database;
  private builtin: BuiltinMemory;
  private saved: Saved;
  private secrets: MemoryCredentials;
  private gate: ModelConnectionGate;
  private keyError: string | null = null;
  isBusy: () => Promise<boolean> = async () => false;

  constructor(
    path: string,
    secrets: MemoryCredentials,
    gate = new ModelConnectionGate(),
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS memory_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
    );
    this.secrets = secrets;
    this.gate = gate;
    this.builtin = new BuiltinMemory(this.db);
    const row = this.db
      .query<{ value: string }, []>(
        "SELECT value FROM memory_settings WHERE id=1",
      )
      .get();
    this.saved = row
      ? (JSON.parse(row.value) as Saved)
      : {
          enabled: true,
          provider: "builtin",
          scope: "owner",
          endpoint: "",
          bankId: "",
          credential: null,
        };
    // Keys saved before destinations were recorded belong to the saved one.
    if (this.saved.credential && !this.saved.credentialFor)
      this.saved.credentialFor = {
        endpoint: this.saved.endpoint,
        bankId: this.saved.bankId,
      };
    // An undecryptable key fails closed for Hindsight only: it is never used,
    // and the rest of the runtime (chat, built-in memory) still starts.
    try {
      const key = this.secrets.openMemoryKey(this.saved.credential);
      if (key) registerRedactionSecret(key);
    } catch {
      this.keyError =
        "The saved Hindsight API key cannot be decrypted on this device. Re-enter it in Settings → Memory.";
    }
  }

  read(): MemoryStatus {
    const { credential, ...configuration } = this.saved;
    const external = configuration.provider === "hindsight";
    return {
      configuration: { ...configuration, hasCredential: credential !== null },
      capabilities: {
        browse: !external,
        retain: true,
        recall: true,
        reflect: external ? "provider" : "model-assisted",
        revise: !external,
        forget: !external,
        consolidation: external ? "provider" : "none",
      },
      error: external ? this.keyError : null,
    };
  }

  async configure(input: SaveMemoryConfiguration) {
    const parsed = memoryConfigurationInput.safeParse(input);
    if (!parsed.success) throw new InputError("Invalid memory configuration.");
    return this.gate.run(async () => {
      if (await this.isBusy())
        throw new InputError(
          "Wait for active turns to finish before changing memory settings.",
          409,
        );
      const { apiKey, ...configuration } = parsed.data;
      // Built-in memory has no destination: keep the saved Hindsight one, so
      // the destination only changes where the key rules below apply.
      if (configuration.provider === "builtin") {
        configuration.endpoint = this.saved.endpoint;
        configuration.bankId = this.saved.bankId;
      } else {
        let url: URL;
        try {
          url = new URL(configuration.endpoint);
        } catch {
          throw new InputError("Enter a valid Hindsight endpoint.");
        }
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !(
            url.protocol === "https:" ||
            (url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          )
        )
          throw new InputError(
            "Use HTTPS, or HTTP on localhost, without URL credentials, query or fragment.",
          );
        configuration.endpoint = url.toString().replace(/\/$/, "");
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(configuration.bankId))
          throw new InputError(
            "Enter a Hindsight bank ID using letters, numbers, underscores or hyphens.",
          );
      }
      const destination = {
        endpoint: configuration.endpoint,
        bankId: configuration.bankId,
      };
      if (
        apiKey === undefined &&
        this.saved.credential &&
        !sameDestination(destination, this.saved.credentialFor)
      )
        throw new InputError(
          "Re-enter or clear the API key when changing the Hindsight destination.",
        );
      const credential =
        apiKey === undefined
          ? this.saved.credential
          : this.secrets.sealMemoryKey(apiKey);
      const next: Saved = {
        ...configuration,
        credential,
        credentialFor:
          apiKey === undefined ? this.saved.credentialFor : destination,
      };
      if (apiKey !== undefined) this.keyError = null;
      this.db
        .query(
          "INSERT INTO memory_settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(next));
      this.saved = next;
      if (apiKey) registerRedactionSecret(apiKey);
      return this.read();
    });
  }

  private backend(): MemoryBackend {
    if (!this.saved.enabled)
      throw new InputError(
        "Memory is disabled. Enable it in Settings → Memory.",
        409,
      );
    if (this.saved.provider === "builtin") return this.builtin;
    if (this.keyError) throw new InputError(this.keyError, 503);
    const { endpoint, bankId, credential, credentialFor } = this.saved;
    // Defense in depth: never send a key to a destination it was not saved for.
    if (credential && !sameDestination({ endpoint, bankId }, credentialFor))
      throw new InputError(
        "Re-enter the Hindsight API key for this destination in Settings → Memory.",
        409,
      );
    return new HindsightMemory(
      endpoint,
      bankId,
      this.secrets.openMemoryKey(credential),
    );
  }

  /**
   * Read the configuration under the gate so an operation never sees a
   * half-applied change, then run it outside: memory I/O (Hindsight calls can
   * take up to 60 s) must not hold the lock that admits chat messages.
   */
  private async run<T>(
    operation: (backend: MemoryBackend, scope: string) => Promise<T>,
  ) {
    const [backend, scope] = await this.gate.run(
      async () => [this.backend(), this.saved.scope] as const,
    );
    return operation(backend, scope);
  }

  async test() {
    return this.run((backend) => backend.test());
  }

  async retain(input: RetainMemory) {
    const parsed = z
      .object({
        id: idInput,
        content: contentInput,
        kind: z.enum(["fact", "experience"]),
        source: z.string().min(1).max(512),
        eventTime: z.number().int().min(0).max(8.64e15),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success) throw new InputError("Invalid memory evidence.");
    return this.run((backend, scope) => backend.retain(scope, parsed.data));
  }

  async browse(after?: string) {
    return this.run((backend, scope) => {
      if (!backend.browse)
        throw new InputError(
          "Browsing all memories is not supported by this backend. Use search or the provider’s interface.",
        );
      return backend.browse(scope, after);
    });
  }

  async recall(query: string) {
    if (!queryInput.safeParse(query).success)
      throw new InputError("Enter a memory query (up to 2000 characters).");
    return this.run((backend, scope) => backend.recall(scope, query));
  }

  async reflect(query: string) {
    if (!queryInput.safeParse(query).success)
      throw new InputError("Enter a memory query (up to 2000 characters).");
    return this.run(async (backend, scope) => {
      if (backend.reflect) return backend.reflect(scope, query);
      const recalled = await backend.recall(scope, query);
      return {
        ...recalled,
        mode: "model-assisted" as const,
        answer: recalled.evidence.length
          ? "Use the attached evidence to answer the question, citing evidence IDs. Separate inference from recorded facts."
          : "No relevant evidence was found. Do not infer a remembered answer.",
      };
    });
  }

  async revise(id: string, content: string) {
    if (
      !idInput.safeParse(id).success ||
      !contentInput.safeParse(content).success
    )
      throw new InputError("Invalid memory correction.");
    return this.run((backend, scope) =>
      backend.revise(scope, id, content.trim()),
    );
  }

  async forget(id: string) {
    if (!idInput.safeParse(id).success)
      throw new InputError("Invalid memory ID.");
    return this.run((backend, scope) => backend.forget(scope, id));
  }

  close() {
    this.db.close();
  }
}
