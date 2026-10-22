import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  MemoryConfiguration,
  MemoryStatus,
  SaveMemoryConfiguration,
} from "@raphie/contracts";
import { z } from "zod";

import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";
import type { EncryptedCredential } from "../../settings/infrastructure/credential-cipher.ts";
import type {
  MemoryBackend,
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

type Secrets = {
  sealMemoryKey(value: string | null): EncryptedCredential | null;
  openMemoryKey(value: EncryptedCredential | null): string | null;
};

type Saved = Omit<MemoryConfiguration, "hasCredential"> & {
  credential: EncryptedCredential | null;
};

export class RuntimeMemory implements MemoryService {
  private db: Database;
  private builtin: BuiltinMemory;
  private saved: Saved;
  private secrets: Secrets;
  private gate: ModelConnectionGate;
  isBusy: () => Promise<boolean> = async () => false;

  constructor(
    path: string,
    secrets: Secrets,
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
    // Fail closed if the OS-backed Settings key cannot decrypt a saved connection.
    const key = this.secrets.openMemoryKey(this.saved.credential);
    if (key) registerRedactionSecret(key);
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
      error: null,
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
      if (configuration.provider === "hindsight") {
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
      const destinationChanged =
        configuration.endpoint !== this.saved.endpoint ||
        configuration.bankId !== this.saved.bankId;
      if (
        configuration.provider === "hindsight" &&
        destinationChanged &&
        apiKey === undefined &&
        this.saved.credential
      )
        throw new InputError(
          "Re-enter or clear the API key when changing the Hindsight destination.",
        );
      const credential =
        apiKey === undefined
          ? this.saved.credential
          : this.secrets.sealMemoryKey(apiKey);
      const next = { ...configuration, credential };
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
    return this.saved.provider === "builtin"
      ? this.builtin
      : new HindsightMemory(
          this.saved.endpoint,
          this.saved.bankId,
          this.secrets.openMemoryKey(this.saved.credential),
        );
  }

  private run<T>(
    operation: (backend: MemoryBackend, scope: string) => Promise<T>,
  ) {
    return this.gate.run(() => operation(this.backend(), this.saved.scope));
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
