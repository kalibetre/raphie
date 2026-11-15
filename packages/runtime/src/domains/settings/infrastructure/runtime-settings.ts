import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { OAuthCredential } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import type {
  EditProviderConnection,
  ProviderSignIn,
  RuntimeSettings,
  SaveProviderConnection,
  StartProviderSignIn,
  UpdateRuntimeSettings,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";
import type { SettingsService } from "../application/ports.ts";
import {
  configuredCredentialKeyStore,
  CredentialCipher,
  type CredentialKeyStore,
  type EncryptedCredential,
} from "./credential-cipher.ts";
import {
  connectionReady,
  PiProviderConnections,
  type StoredConnection,
} from "./pi-provider-connections.ts";
import {
  type SignedIn,
  type SubscriptionProvider,
  SubscriptionSignIns,
} from "./subscription-sign-ins.ts";

type Stored = {
  version: 3;
  telemetryEnabled: boolean;
  modelId: string;
  connectionId: string;
  connections: StoredConnection[];
  /** This installation's id, which some subscription sign-ins send. */
  deviceId?: string;
};

type PreviousStored = Omit<Stored, "version"> & { version: 2 };

/** v4: every connection an encrypted API key. */
type EncryptedStoredV4 = Omit<Stored, "version" | "connections"> & {
  version: 4;
  keyId: string;
  connections: (Omit<StoredConnection, "apiKey" | "oauth" | "auth"> & {
    credential: EncryptedCredential | null;
  })[];
};

/**
 * v5: a connection's `credential` is its encrypted API key, or for a
 * subscription its encrypted token set as JSON. A runtime that only knows
 * v4 refuses v5 rather than mistaking tokens for a key.
 */
type EncryptedStored = Omit<Stored, "version" | "connections"> & {
  version: 5;
  keyId: string;
  connections: (Omit<StoredConnection, "apiKey" | "oauth"> & {
    auth: "api_key" | "oauth";
    credential: EncryptedCredential | null;
  })[];
};

/** Renew a subscription's tokens this long before they expire. */
const REFRESH_EARLY_MS = 5 * 60 * 1000;

type LegacyStored = {
  telemetryEnabled: boolean;
  providerEnabled: boolean;
  modelId: string;
  apiKey: string | null;
};

type SavedSettings =
  Stored | PreviousStored | EncryptedStoredV4 | EncryptedStored | LegacyStored;

type Options = {
  models: MutableModels;
  defaultModel: string;
  verifyKey?: (key: string) => Promise<void>;
  credentialKeyStore?: CredentialKeyStore;
  /** The subscriptions offered; tests pass stand-ins. */
  subscriptionProviders?: SubscriptionProvider[];
};

/** Private credentials never enter Pi documents, session APIs or browser storage. */
export class BackendSettings implements SettingsService {
  private db: Database;
  private state: Stored;
  private options: Options;
  private providers: PiProviderConnections;
  private cipher: CredentialCipher;
  private signIns: SubscriptionSignIns;
  /** Subscriptions whose tokens could not be renewed: sign in again. */
  private needsSignIn = new Set<string>();
  /** Renewals in flight, so concurrent requests renew once. */
  private refreshing = new Map<string, Promise<OAuthCredential>>();
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
    this.signIns = new SubscriptionSignIns({
      providers: options.subscriptionProviders,
      deviceId: () => this.state.deviceId ?? "",
    });
    this.publish(state.connections);
  }

  private publish(connections: StoredConnection[]) {
    this.providers.publish(
      connections,
      (id) => this.signIns.provider(id),
      (id) => this.subscriptionAuth(id),
    );
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
      if (saved && "version" in saved && ![2, 3, 4, 5].includes(saved.version))
        throw new Error();
      const encrypted =
        saved &&
        "version" in saved &&
        (saved.version === 4 || saved.version === 5)
          ? saved
          : undefined;
      if (
        encrypted &&
        (typeof encrypted.keyId !== "string" ||
          !/^[0-9a-f-]{36}$/.test(encrypted.keyId))
      )
        throw new Error();
      cipher = await CredentialCipher.open(
        options.credentialKeyStore ?? configuredCredentialKeyStore(),
        encrypted?.keyId,
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
          auth: c.auth ?? "api_key",
          apiKey: c.apiKey,
          ...(c.oauth ? { oauth: c.oauth } : {}),
          enabled: c.enabled,
        })),
        deviceId:
          saved && "deviceId" in saved && typeof saved.deviceId === "string"
            ? saved.deviceId
            : crypto.randomUUID(),
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
          auth: "api_key" as const,
          apiKey: cipher.decrypt(
            credential,
            connection.id,
            connection.provider,
          ),
        }));
      case 5:
        return saved.connections.map(({ credential, ...connection }) => {
          const secret = cipher.decrypt(
            credential,
            connection.id,
            connection.provider,
          );
          if (connection.auth !== "oauth")
            return { ...connection, apiKey: secret };
          return {
            ...connection,
            apiKey: null,
            oauth: secret ? BackendSettings.parseOAuth(secret) : null,
          };
        });
    }
  }

  /** A saved token set, checked, or an error that keeps the file intact. */
  private static parseOAuth(secret: string): OAuthCredential {
    const value = JSON.parse(secret) as Partial<OAuthCredential>;
    if (
      value.type !== "oauth" ||
      typeof value.access !== "string" ||
      typeof value.refresh !== "string" ||
      typeof value.expires !== "number"
    )
      throw new Error();
    for (const token of [value.access, value.refresh])
      registerRedactionSecret(token);
    return value as OAuthCredential;
  }

  private static encode(state: Stored, cipher: CredentialCipher) {
    const saved: EncryptedStored = {
      ...state,
      version: 5,
      keyId: cipher.keyId,
      connections: state.connections.map(({ apiKey, oauth, ...connection }) => {
        const auth = connection.auth ?? "api_key";
        return {
          ...connection,
          auth,
          credential: cipher.encrypt(
            auth === "oauth" ? (oauth ? JSON.stringify(oauth) : null) : apiKey,
            connection.id,
            connection.provider,
          ),
        };
      }),
    };
    return JSON.stringify(saved);
  }

  /** Memory connection secrets share the Settings master key. */
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
    const selected = this.selectedConnection;
    return selected?.enabled && connectionReady(selected)
      ? { provider: this.state.connectionId, modelId: this.state.modelId }
      : undefined;
  }

  /** The chat models `connection` offers, as Pi lists them. */
  private catalog(connection: StoredConnection | undefined) {
    if (connection?.auth === "oauth") {
      const stock = this.signIns.provider(connection.provider);
      return stock ? PiProviderConnections.chatModels(stock, connection) : [];
    }
    return this.providers.provider.getModels();
  }

  /**
   * A subscription's request auth: its tokens, renewed first when they are
   * near expiry. Renewed tokens are saved, since the refresh token rotates.
   */
  private async subscriptionAuth(connectionId: string) {
    const connection = this.state.connections.find(
      (c) => c.id === connectionId,
    );
    const oauth = connection && this.signIns.oauth(connection.provider);
    if (!connection?.oauth || !oauth)
      throw new InputError("Sign in to this subscription again.", 401);
    let credential = connection.oauth;
    if (credential.expires - Date.now() < REFRESH_EARLY_MS)
      credential = await this.renew(connection.id);
    return oauth.toAuth(credential);
  }

  private renew(connectionId: string) {
    const pending = this.refreshing.get(connectionId);
    if (pending) return pending;
    const run = (async () => {
      const connection = this.state.connections.find(
        (c) => c.id === connectionId,
      );
      const oauth = connection && this.signIns.oauth(connection.provider);
      if (!connection?.oauth || !oauth)
        throw new InputError("Sign in to this subscription again.", 401);
      let renewed: OAuthCredential;
      try {
        renewed = await oauth.refresh(
          connection.oauth,
          AbortSignal.timeout(15_000),
        );
      } catch {
        this.needsSignIn.add(connectionId);
        this.onChange();
        throw new InputError(
          `${connection.name} needs you to sign in again.`,
          401,
        );
      }
      for (const token of [renewed.access, renewed.refresh])
        registerRedactionSecret(token);
      this.needsSignIn.delete(connectionId);
      // Saved without re-registering providers: requests are using them.
      await this.persist(
        {
          ...this.state,
          connections: this.state.connections.map((c) =>
            c.id === connectionId ? { ...c, oauth: renewed } : c,
          ),
        },
        false,
      );
      return renewed;
    })();
    this.refreshing.set(connectionId, run);
    void run
      .finally(() => this.refreshing.delete(connectionId))
      .catch(() => {});
    return run;
  }

  get telemetryEnabled() {
    return this.state.telemetryEnabled;
  }

  async read(): Promise<RuntimeSettings> {
    const active = this.state.connections.filter(
      (c) => c.enabled && connectionReady(c),
    );
    const models = active
      .flatMap((connection) =>
        this.catalog(connection).map((m) => ({
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
      credentialSource:
        this.selectedConnection && connectionReady(this.selectedConnection)
          ? "saved"
          : null,
      modelId: this.state.modelId,
      providers: [
        { id: "openrouter", name: "OpenRouter", auth: ["api_key"] },
        ...this.signIns.offered().map((p) => ({
          ...p,
          auth: ["subscription" as const],
        })),
      ],
      connections: active.map((c) => ({
        id: c.id,
        provider: c.provider,
        name: c.name,
        credentialSource: "saved" as const,
        auth: c.auth === "oauth" ? "subscription" : "api_key",
        ...(this.needsSignIn.has(c.id) ? { needsSignIn: true } : {}),
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
    if (publishConnections) this.publish(next.connections);
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
    const target = this.state.connections.find(
      (c) => c.id === (input.connectionId ?? this.state.connectionId),
    );
    if (
      input.modelId !== undefined &&
      !this.catalog(target).some((m) => m.id === input.modelId)
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
          (c) => c.id === connectionId && c.enabled && connectionReady(c),
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
    if (input.apiKey && connection.auth === "oauth")
      throw new InputError(
        "A subscription has no API key; sign in again instead.",
      );
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
        (c) => c.enabled && connectionReady(c),
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
    // A subscription is working when its tokens are, renewed if need be.
    if (connection.auth === "oauth") {
      await this.subscriptionAuth(id);
      return;
    }
    await this.testProvider(apiKey ?? this.providers.key(connection));
  }

  /** Starts signing in to a subscription, for a new connection or to renew one. */
  startSignIn(input: StartProviderSignIn): ProviderSignIn {
    if (input.connectionId) {
      const existing = this.state.connections.find(
        (c) => c.id === input.connectionId,
      );
      if (!existing) throw new InputError("Connection not found.", 404);
      if (existing.auth !== "oauth" || existing.provider !== input.provider)
        throw new InputError("Only a subscription can be signed in again.");
    }
    return this.signIns.start(input, (signedIn) => this.saveSignIn(signedIn));
  }

  readSignIn(id: string) {
    return this.signIns.read(id);
  }

  answerSignIn(id: string, promptId: string, value: string) {
    return this.signIns.answer(id, promptId, value);
  }

  cancelSignIn(id: string) {
    return this.signIns.cancel(id);
  }

  /** Saves a finished sign-in; returns the connection it went to. */
  private async saveSignIn(signedIn: SignedIn) {
    return this.connectionGate.run(async () => {
      await this.checkIdle();
      const renewing = signedIn.connectionId
        ? this.state.connections.find((c) => c.id === signedIn.connectionId)
        : undefined;
      if (signedIn.connectionId && !renewing)
        throw new InputError("Connection not found.", 404);
      const connection: StoredConnection = renewing
        ? { ...renewing, oauth: signedIn.credential }
        : {
            id: `${signedIn.provider}_${crypto.randomUUID()}`,
            provider: signedIn.provider,
            name: signedIn.name,
            auth: "oauth",
            apiKey: null,
            oauth: signedIn.credential,
            enabled: true,
          };
      this.needsSignIn.delete(connection.id);
      // With no working default yet, this connection becomes it, with a
      // model it actually offers.
      const becomesDefault = !this.model;
      const offered = this.catalog(connection);
      const modelId =
        !becomesDefault || offered.some((m) => m.id === this.state.modelId)
          ? this.state.modelId
          : (offered[0]?.id ?? this.state.modelId);
      await this.persist({
        ...this.state,
        modelId,
        connectionId: becomesDefault ? connection.id : this.state.connectionId,
        connections: renewing
          ? this.state.connections.map((c) =>
              c.id === connection.id ? connection : c,
            )
          : [...this.state.connections, connection],
      });
      return connection.id;
    });
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
    this.signIns.close();
    this.db.close();
    this.cipher.close();
  }
}
