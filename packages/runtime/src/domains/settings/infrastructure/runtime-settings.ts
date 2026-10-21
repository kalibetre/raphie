import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { Models } from "@earendil-works/pi-ai/models";
import type { RuntimeSettings, UpdateRuntimeSettings } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";
import type { SettingsService } from "../application/ports.ts";

type Stored = {
  telemetryEnabled: boolean;
  providerEnabled: boolean;
  modelId: string;
  apiKey: string | null;
};

type Options = {
  models: Models;
  environmentKey?: string;
  defaultModel: string;
  verifyKey?: (key: string) => Promise<void>;
  /** OpenRouter's cached list; without one, Pi's bundled models are listed. */
  catalog?: {
    ensure(): Promise<void>;
    refresh(): Promise<void>;
    fetchedAt(): Promise<number | null>;
  };
};

/** Private credentials never enter Pi documents, session APIs or browser storage. */
export class BackendSettings implements SettingsService {
  private db: Database;
  private state: Stored;
  private options: Options;
  readonly connectionGate = new ModelConnectionGate();
  onChange: () => void = () => {};
  isBusy: () => Promise<boolean> = async () => false;

  private constructor(db: Database, state: Stored, options: Options) {
    this.db = db;
    this.state = state;
    this.options = options;
    if (state.apiKey) registerRedactionSecret(state.apiKey);
  }

  static async open(path: string, options: Options) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { strict: true });
    try {
      await chmod(path, 0o600);
      db.exec(
        "PRAGMA secure_delete = ON; CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)",
      );
      const row = db
        .query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1")
        .get();
      const state: Stored = row
        ? JSON.parse(row.value)
        : {
            telemetryEnabled: true,
            providerEnabled: true,
            modelId: options.defaultModel,
            apiKey: null,
          };
      return new BackendSettings(db, state, options);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  get key() {
    return this.state.apiKey ?? this.options.environmentKey;
  }

  get model() {
    return this.state.providerEnabled && this.key
      ? { provider: "openrouter", modelId: this.state.modelId }
      : undefined;
  }

  get telemetryEnabled() {
    return this.state.telemetryEnabled;
  }

  async read(): Promise<RuntimeSettings> {
    const catalog = this.options.catalog;
    await catalog?.ensure();
    const fetchedAt = (await catalog?.fetchedAt()) ?? null;
    const models = [...this.options.models.getModels("openrouter")]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        ...(m.cost.input || m.cost.output
          ? { pricing: { input: m.cost.input, output: m.cost.output } }
          : {}),
      }));
    return {
      telemetryEnabled: this.state.telemetryEnabled,
      provider: "openrouter",
      providerEnabled: this.state.providerEnabled,
      modelId: this.state.modelId,
      credentialSource: this.state.apiKey
        ? "saved"
        : this.options.environmentKey
          ? "environment"
          : null,
      providers: [{ id: "openrouter", name: "OpenRouter" }],
      models,
      modelCatalog: {
        source: fetchedAt ? "openrouter" : "bundled",
        fetchedAt,
      },
    };
  }

  async update(input: UpdateRuntimeSettings) {
    if (input.provider !== undefined && input.provider !== "openrouter")
      throw new InputError("Choose an available provider.");
    if (
      input.modelId !== undefined &&
      !this.options.models.getModel("openrouter", input.modelId)
    )
      throw new InputError("Choose a model from the available catalog.");
    const changesModel =
      input.apiKey !== undefined || input.providerEnabled !== undefined;
    if (changesModel && (await this.isBusy()))
      throw new InputError(
        "Wait for active turns to finish before changing the model connection.",
        409,
      );
    if (typeof input.apiKey === "string") await this.testProvider(input.apiKey);
    const apply = async () => {
      // Admission cannot capture a model until this check and settings publication finish.
      if (changesModel && (await this.isBusy()))
        throw new InputError(
          "Wait for active turns to finish before changing the model connection.",
          409,
        );
      const next = {
        ...this.state,
        ...(input.telemetryEnabled !== undefined
          ? { telemetryEnabled: input.telemetryEnabled }
          : {}),
        ...(input.providerEnabled !== undefined
          ? { providerEnabled: input.providerEnabled }
          : {}),
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      };
      this.db
        .query(
          "INSERT INTO settings (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(next));
      this.state = next;
      if (next.apiKey) registerRedactionSecret(next.apiKey);
      this.onChange();
      return this.read();
    };
    // Telemetry-only updates retain their existing availability during active turns.
    return changesModel ? this.connectionGate.run(apply) : apply();
  }

  async refreshModels() {
    try {
      await this.options.catalog?.refresh();
    } catch {
      throw new InputError(
        "Could not reach OpenRouter to fetch models. Try again later.",
        503,
      );
    }
    return this.read();
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
  }
}
