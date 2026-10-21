import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  Api,
  Model,
  ModelsStore,
  ModelsStoreEntry,
  MutableModels,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createProvider } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import {
  openRouterCost,
  type OpenRouterModel,
} from "@earendil-works/pi-ai/providers/openrouter-api";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Pi's OpenRouter provider made dynamic. Pi restores, merges, persists and
 * publishes the list; Raphie only supplies the fetch, because Pi's stock
 * OpenRouter provider ships a static catalog.
 */
export function dynamicOpenRouterProvider(fetcher: typeof fetch = fetch) {
  const stock = openrouterProvider();
  return createProvider({
    id: stock.id,
    name: stock.name,
    baseUrl: stock.baseUrl,
    auth: stock.auth,
    models: stock.getModels(),
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
    },
    fetchModels: async (context) => {
      const credential = context.credential;
      const key =
        credential?.type === "oauth" ? credential.access : credential?.key;
      // GET /models/user: every model and price this key may use, in one
      // request. Pi's personalizeOpenRouterCatalog reads the same endpoint but
      // only narrows its static catalog, so it cannot add new models.
      const response = await fetcher(
        `${context.baseUrl ?? stock.baseUrl}/models/user`,
        {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.any([
            context.signal,
            AbortSignal.timeout(15_000),
          ]),
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
      const { data } = (await response.json()) as { data?: Listed[] };
      if (!Array.isArray(data))
        throw new Error("Invalid OpenRouter model list");
      const known = new Map(stock.getModels().map((m) => [m.id, m]));
      return data.flatMap((entry) => toModel(entry, known));
    },
  });
}

type Listed = OpenRouterModel & {
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
};

/** Pi's generated catalog format is not shipped, so map OpenRouter's entry. */
function toModel(entry: Listed, known: Map<string, Model<Api>>): Model<Api>[] {
  const context = entry.top_provider?.context_length || entry.context_length;
  // Raphie's turns need text replies and tool calls.
  if (
    !entry.name ||
    !context ||
    !entry.architecture?.output_modalities?.includes("text") ||
    !entry.supported_parameters?.includes("tools")
  )
    return [];
  const maxTokens = entry.top_provider?.max_completion_tokens || undefined;
  const base = known.get(entry.id);
  // Pi's definition knows the right API and quirks; refresh what changes.
  if (base)
    return [
      {
        ...base,
        name: entry.name,
        contextWindow: context,
        maxTokens: maxTokens ?? base.maxTokens,
        cost: openRouterCost(entry.pricing),
      },
    ];
  const reasoning = entry.supported_parameters.includes("reasoning");
  return [
    {
      type: "chat",
      id: entry.id,
      name: entry.name,
      api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1",
      provider: "openrouter",
      reasoning,
      input: entry.architecture.input_modalities?.includes("image")
        ? ["text", "image"]
        : ["text"],
      cost: openRouterCost(entry.pricing),
      contextWindow: context,
      maxTokens: maxTokens ?? Math.min(32_768, Math.floor(context / 4)),
      compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
    } as Model<Api>,
  ];
}

/** Pi's catalog store, persisted in SQLite (Pi ships only an in-memory one). */
export class SqliteModelsStore implements ModelsStore {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(path: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { strict: true });
    db.exec(
      "CREATE TABLE IF NOT EXISTS catalogs (provider TEXT PRIMARY KEY, entry TEXT NOT NULL)",
    );
    return new SqliteModelsStore(db);
  }

  async read(provider: string) {
    const row = this.db
      .query<{ entry: string }, [string]>(
        "SELECT entry FROM catalogs WHERE provider = ?",
      )
      .get(provider);
    return row ? (JSON.parse(row.entry) as ModelsStoreEntry) : undefined;
  }

  async write(provider: string, entry: ModelsStoreEntry) {
    this.db
      .query(
        "INSERT INTO catalogs (provider, entry) VALUES (?, ?) ON CONFLICT(provider) DO UPDATE SET entry = excluded.entry",
      )
      .run(provider, JSON.stringify(entry));
  }

  async delete(provider: string) {
    this.db.query("DELETE FROM catalogs WHERE provider = ?").run(provider);
  }

  close() {
    this.db.close();
  }
}

/** The only policy Raphie adds: refetch a list older than a week. */
export class ModelCatalog {
  private models: MutableModels;
  private store: ModelsStore;
  private now: () => number;
  private pending: Promise<void> | undefined;

  constructor(models: MutableModels, store: ModelsStore, now = Date.now) {
    this.models = models;
    this.store = store;
    this.now = now;
  }

  async fetchedAt() {
    return (await this.store.read("openrouter"))?.checkedAt ?? null;
  }

  /** Restore the cached list without network access. */
  async restore() {
    await this.models.refresh({
      providers: ["openrouter"],
      allowNetwork: false,
    });
  }

  /** Wait for a first list; refresh a week-old one in the background. */
  async ensure() {
    const fetchedAt = await this.fetchedAt();
    if (fetchedAt === null) await this.refresh().catch(() => {});
    else if (this.now() - fetchedAt > WEEK) void this.refresh().catch(() => {});
  }

  /** Fetch now; concurrent callers share one fetch. Pi keeps the current list on failure. */
  refresh() {
    this.pending ??= this.models
      .refresh({ providers: ["openrouter"], force: true })
      .then((result) => {
        const error = result.errors.get("openrouter");
        if (error) throw error;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}
