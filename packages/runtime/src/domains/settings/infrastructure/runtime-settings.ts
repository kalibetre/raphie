import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { MutableModels } from "@earendil-works/pi-ai/models";
import type {
  EditProviderConnection,
  RuntimeSettings,
  SaveProviderConnection,
  UpdateRuntimeSettings,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";
import type { SettingsService } from "../application/ports.ts";
import {
  CredentialCipher,
  type CredentialKeyStore,
  type EncryptedCredential,
  osCredentialKeyStore,
} from "./credential-cipher.ts";
import {
  PiProviderConnections,
  type StoredConnection,
} from "./pi-provider-connections.ts";

type Stored = {
  version: 3;
  telemetryEnabled: boolean;
  modelId: string;
  connectionId: string;
  connections: StoredConnection[];
};

type PreviousStored = Omit<Stored, "version"> & { version: 2 };

type EncryptedStored = Omit<Stored, "version" | "connections"> & {
  version: 4;
  keyId: string;
  connections: (Omit<StoredConnection, "apiKey"> & {
    credential: EncryptedCredential | null;
  })[];
};

type LegacyStored = {
  telemetryEnabled: boolean;
  providerEnabled: boolean;
  modelId: string;
  apiKey: string | null;
};

type SavedSettings = Stored | PreviousStored | EncryptedStored | LegacyStored;

type Options = {
  models: MutableModels;
  defaultModel: string;
  verifyKey?: (key: string) => Promise<void>;
  credentialKeyStore?: CredentialKeyStore;
};

/** Private credentials never enter Pi documents, session APIs or browser storage. */
export class BackendSettings implements SettingsService {
  private db: Database;
  private state: Stored;
  private options: Options;
  private providers: PiProviderConnections;
  private cipher: CredentialCipher;
  readonly connectionGate = new ModelConnectionGate();
  onChange: () => void = () => {};
  isBusy: () => Promise<boolean> = async () => false;

  private constructor(
    db: Database,
    state: Stored,
    options: Options,
    cipher: CredentialCipher,
  ) {
    this.db = db;
    this.cipher = cipher;
    this.state = state;
    this.options = options;
    this.providers = new PiProviderConnections(options.models);
    this.providers.publish(state.connections);
  }

  static async open(path: string, options: Options) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { strict: true });
    let cipher: CredentialCipher | undefined;
    try {
      await chmod(path, 0o600);
      db.exec(
        "PRAGMA secure_delete = ON; CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)",
      );
      // Drain/remove any historical WAL before rewriting. Fail if another reader prevents it.
      const journal = db
        .query<{ journal_mode: string }, []>("PRAGMA journal_mode = DELETE")
        .get();
      if (journal?.journal_mode !== "delete") throw new Error();
      db.exec(
        "PRAGMA temp_store = MEMORY; PRAGMA synchronous = FULL; BEGIN IMMEDIATE",
      );
      const row = db
        .query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1")
        .get();
      const saved = row ? (JSON.parse(row.value) as SavedSettings) : undefined;
      if (saved && "version" in saved && ![2, 3, 4].includes(saved.version))
        throw new Error();
      if (
        saved &&
        "version" in saved &&
        saved.version === 4 &&
        (typeof saved.keyId !== "string" ||
          !/^[0-9a-f-]{36}$/.test(saved.keyId))
      )
        throw new Error();
      cipher = await CredentialCipher.open(
        options.credentialKeyStore ?? osCredentialKeyStore,
        saved && "version" in saved && saved.version === 4
          ? saved.keyId
          : undefined,
      );
      const connections = BackendSettings.decodeConnections(saved, cipher);
      const state: Stored = {
        version: 3,
        telemetryEnabled: saved?.telemetryEnabled ?? true,
        modelId: saved?.modelId ?? options.defaultModel,
        connectionId:
          saved && "version" in saved ? saved.connectionId : "openrouter",
        connections: connections.map((c) => ({
          id: c.id,
          provider: c.provider,
          name: c.name,
          apiKey: c.apiKey,
          enabled: c.enabled,
        })),
      };
      db.query(
        "INSERT INTO settings (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      ).run(BackendSettings.encode(state, cipher));
      db.exec("COMMIT");
      // Repeated on every startup so a crash after COMMIT cannot skip remnant cleanup.
      db.exec("VACUUM");
      return new BackendSettings(db, state, options, cipher);
    } catch (error) {
      cipher?.close();
      db.close();
      if (error instanceof InputError) throw error;
      throw new InputError(
        "Settings storage could not be opened or migrated safely. Stop other runtimes using this data directory, check disk access and free space, then restart. Saved connections were not discarded.",
        503,
      );
    }
  }

  private static decodeConnections(
    saved: SavedSettings | undefined,
    cipher: CredentialCipher,
  ): StoredConnection[] {
    if (!saved) return [];
    if (!("version" in saved)) {
      if (!saved.apiKey) return [];
      return [
        {
          id: "openrouter",
          provider: "openrouter",
          name: "OpenRouter",
          apiKey: saved.apiKey,
          enabled: saved.providerEnabled,
        },
      ];
    }

    switch (saved.version) {
      case 2:
        // Discard old environment-only entries, preserving saved identities.
        return saved.connections.filter((connection) => connection.apiKey);
      case 3:
        return saved.connections;
      case 4:
        return saved.connections.map(({ credential, ...connection }) => ({
          ...connection,
          apiKey: cipher.decrypt(
            credential,
            connection.id,
            connection.provider,
          ),
        }));
    }
  }

  private static encode(state: Stored, cipher: CredentialCipher) {
    const saved: EncryptedStored = {
      ...state,
      version: 4,
      keyId: cipher.keyId,
      connections: state.connections.map(({ apiKey, ...connection }) => ({
        ...connection,
        credential: cipher.encrypt(apiKey, connection.id, connection.provider),
      })),
    };
    return JSON.stringify(saved);
  }

  /** Memory connection secrets share the OS-backed Settings master key. */
  sealMemoryKey(value: string | null) {
    return this.cipher.encrypt(value, "memory-connection", "memory");
  }

  openMemoryKey(value: EncryptedCredential | null) {
    return this.cipher.decrypt(value, "memory-connection", "memory");
  }

  private get selectedConnection() {
    return this.state.connections.find((c) => c.id === this.state.connectionId);
  }

  get key() {
    const connection = this.selectedConnection;
    return connection ? this.providers.key(connection) : undefined;
  }

  get model() {
    return this.selectedConnection?.enabled && this.key
      ? { provider: this.state.connectionId, modelId: this.state.modelId }
      : undefined;
  }

  get telemetryEnabled() {
    return this.state.telemetryEnabled;
  }

  async read(): Promise<RuntimeSettings> {
    const active = this.state.connections.filter(
      (c) => c.enabled && this.providers.key(c),
    );
    const models = active
      .flatMap((connection) =>
        this.providers.provider.getModels().map((m) => ({
          id: m.id,
          name: m.name,
          provider: connection.provider,
          connectionId: connection.id,
          connectionName: connection.name,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxTokens,
          reasoning: m.reasoning,
          inputModalities: m.input,
          pricing: { input: m.cost.input, output: m.cost.output },
        })),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.connectionName.localeCompare(b.connectionName),
      );
    return {
      telemetryEnabled: this.state.telemetryEnabled,
      provider: this.state.connectionId,
      providerEnabled: this.selectedConnection?.enabled ?? false,
      credentialSource: this.key ? "saved" : null,
      modelId: this.state.modelId,
      providers: [{ id: "openrouter", name: "OpenRouter" }],
      connections: active.map((c) => ({
        id: c.id,
        provider: c.provider,
        name: c.name,
        credentialSource: "saved" as const,
      })),
      models,
    };
  }

  private persist(next: Stored, publishConnections = true) {
    try {
      this.db
        .query(
          "INSERT INTO settings (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(BackendSettings.encode(next, this.cipher));
    } catch {
      throw new InputError(
        "Settings could not be saved securely. Check disk access and free space; the previous settings remain active.",
        503,
      );
    }
    this.state = next;
    if (publishConnections) this.providers.publish(next.connections);
    this.onChange();
    return this.read();
  }

  private async checkIdle() {
    if (await this.isBusy())
      throw new InputError(
        "Wait for active turns to finish before changing the model connection.",
        409,
      );
  }

  async update(input: UpdateRuntimeSettings) {
    if (input.provider !== undefined && input.provider !== "openrouter")
      throw new InputError("Choose an available provider.");
    if (
      input.modelId !== undefined &&
      !this.providers.provider.getModels().some((m) => m.id === input.modelId)
    )
      throw new InputError("Choose a model from the available catalog.");
    const changesConnection =
      input.apiKey !== undefined || input.providerEnabled !== undefined;
    if (changesConnection) await this.checkIdle();
    if (typeof input.apiKey === "string") await this.testProvider(input.apiKey);
    const apply = async () => {
      if (changesConnection) await this.checkIdle();
      const connectionId = input.connectionId ?? this.state.connectionId;
      if (
        input.connectionId &&
        !this.state.connections.some(
          (c) => c.id === connectionId && c.enabled && this.providers.key(c),
        )
      )
        throw new InputError("Choose a connected provider connection.");
      const connections =
        this.state.connections.some((c) => c.id === connectionId) ||
        typeof input.apiKey !== "string"
          ? this.state.connections
          : [
              ...this.state.connections,
              {
                id: connectionId,
                provider: "openrouter" as const,
                name: "OpenRouter",
                apiKey: null,
                enabled: true,
              },
            ];
      return this.persist(
        {
          ...this.state,
          connectionId,
          telemetryEnabled:
            input.telemetryEnabled ?? this.state.telemetryEnabled,
          modelId: input.modelId ?? this.state.modelId,
          connections: connections.map((c) =>
            c.id !== connectionId
              ? c
              : {
                  ...c,
                  ...(input.apiKey !== undefined
                    ? { apiKey: input.apiKey }
                    : {}),
                  ...(input.providerEnabled !== undefined
                    ? { enabled: input.providerEnabled }
                    : {}),
                },
          ),
        },
        changesConnection,
      );
    };
    return changesConnection ? this.connectionGate.run(apply) : apply();
  }

  async addConnection(input: SaveProviderConnection) {
    if (input.provider !== "openrouter")
      throw new InputError("Choose an available provider.");
    await this.checkIdle();
    await this.testProvider(input.apiKey);
    return this.connectionGate.run(async () => {
      await this.checkIdle();
      const connection: StoredConnection = {
        id: `openrouter_${crypto.randomUUID()}`,
        provider: "openrouter",
        name: input.name,
        apiKey: input.apiKey,
        enabled: true,
      };
      return this.persist({
        ...this.state,
        connectionId: this.model ? this.state.connectionId : connection.id,
        connections: [...this.state.connections, connection],
      });
    });
  }

  async editConnection(id: string, input: EditProviderConnection) {
    const connection = this.state.connections.find((c) => c.id === id);
    if (!connection) throw new InputError("Connection not found.", 404);
    await this.checkIdle();
    if (input.apiKey) await this.testProvider(input.apiKey);
    return this.connectionGate.run(async () => {
      await this.checkIdle();
      if (!this.state.connections.some((c) => c.id === id))
        throw new InputError("Connection not found.", 404);
      return this.persist({
        ...this.state,
        connections: this.state.connections.map((c) =>
          c.id !== id
            ? c
            : {
                ...c,
                name: input.name,
                ...(input.apiKey ? { apiKey: input.apiKey } : {}),
              },
        ),
      });
    });
  }

  async removeConnection(id: string) {
    return this.connectionGate.run(async () => {
      await this.checkIdle();
      if (!this.state.connections.some((c) => c.id === id))
        throw new InputError("Connection not found.", 404);
      const connections = this.state.connections.filter((c) => c.id !== id);
      const replacement = connections.find(
        (c) => c.enabled && this.providers.key(c),
      );
      return this.persist({
        ...this.state,
        connections,
        connectionId:
          this.state.connectionId === id
            ? (replacement?.id ?? id)
            : this.state.connectionId,
      });
    });
  }

  async testConnection(id: string, apiKey?: string) {
    const connection = this.state.connections.find((c) => c.id === id);
    if (!connection) throw new InputError("Connection not found.", 404);
    await this.testProvider(apiKey ?? this.providers.key(connection));
  }

  async testProvider(apiKey = this.key) {
    if (!apiKey || apiKey.length > 4096 || /\s/.test(apiKey))
      throw new InputError("Enter a valid OpenRouter API key.");
    registerRedactionSecret(apiKey);
    try {
      if (this.options.verifyKey) return await this.options.verifyKey(apiKey);
      // Checks authentication without making a model request or returning key metadata.
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Rejected key");
    } catch {
      throw new InputError(
        "OpenRouter connection failed. Check the key and try again.",
        503,
      );
    }
  }

  close() {
    this.db.close();
    this.cipher.close();
  }
}
