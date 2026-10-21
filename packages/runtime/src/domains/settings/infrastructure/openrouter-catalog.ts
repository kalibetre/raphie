import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Models } from "@earendil-works/pi-ai/models";
import type { RuntimeSettings } from "@raphie/contracts";

/**
 * Models offered in the picker. Pi can only run models in its bundled catalog
 * (it needs each model's API), so ids missing there are skipped. Edit freely.
 */
export const CURATED_MODELS = [
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-fable-5.1",
  "openai/gpt-6.1-sol",
  "openai/gpt-6-luna",
  "openai/gpt-5.4-mini",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.8-flash",
  "x-ai/grok-4.7",
  "deepseek/deepseek-v4-pro-0813",
  "deepseek/deepseek-v4.1-flash",
  "moonshotai/kimi-k3",
  "qwen/qwen3.8-max-0902",
  "z-ai/glm-5.3",
  "mistralai/mistral-large-4-0",
];

const DAY = 24 * 60 * 60 * 1000;
const RETRY_OFFLINE = 60 * 60 * 1000;
const BASE = "https://openrouter.ai/api/v1/models";

type Meta = RuntimeSettings["models"][number];

// null records a model OpenRouter no longer lists.
type Cache = { fetchedAt: number; models: Record<string, Meta | null> };

type Options = {
  path: string;
  models: Models;
  fetch?: typeof fetch;
  now?: () => number;
};

/**
 * Curated OpenRouter models with metadata refreshed from OpenRouter at most
 * daily, one small public request per model (no key, no full catalog), and
 * cached on disk so restarts and offline starts stay instant.
 */
export class OpenRouterCatalog {
  private cache: Cache = { fetchedAt: 0, models: {} };
  private refreshing: Promise<void> | undefined;
  private options: Options;
  private fetch: typeof fetch;
  private now: () => number;

  constructor(options: Options) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.options.path, "utf8"));
      if (typeof value?.fetchedAt === "number" && value.models)
        this.cache = value;
    } catch {
      // Missing or corrupt cache: Pi's bundled metadata covers until refresh.
    }
    return this;
  }

  /** Curated models plus `extra` ids (default, saved, session models). */
  list(extra: string[] = []): Meta[] {
    const ids = [...new Set([...CURATED_MODELS, ...extra])].filter((id) =>
      this.options.models.getModel("openrouter", id),
    );
    if (this.now() - this.cache.fetchedAt > DAY) void this.refresh(ids);
    return ids.flatMap((id) => {
      const model = this.options.models.getModel("openrouter", id)!;
      const meta = this.cache.models[id];
      // A model a session still uses stays listed so the session can continue.
      if (meta === null && !extra.includes(id)) return [];
      return [
        meta ?? {
          id,
          name: model.name,
          contextWindow: model.contextWindow,
        },
      ];
    });
  }

  /** Stale-while-revalidate: concurrent callers share one refresh. */
  refresh(ids = CURATED_MODELS) {
    this.refreshing ??= this.fetchAll(ids).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async fetchAll(ids: string[]) {
    const results = await Promise.all(
      ids.map(async (id) => [id, await this.fetchOne(id)] as const),
    );
    const models = { ...this.cache.models };
    let reached = false;
    for (const [id, meta] of results) {
      if (meta === undefined) continue; // Network failure keeps old data.
      models[id] = meta;
      reached = true;
    }
    // Offline: try again in an hour rather than on every read.
    const fetchedAt = reached ? this.now() : this.now() - DAY + RETRY_OFFLINE;
    this.cache = { fetchedAt, models };
    await mkdir(dirname(this.options.path), { recursive: true });
    const temporary = `${this.options.path}.tmp`;
    await writeFile(temporary, JSON.stringify(this.cache));
    await rename(temporary, this.options.path);
  }

  private async fetchOne(id: string): Promise<Meta | null | undefined> {
    try {
      const response = await this.fetch(`${BASE}/${id}/endpoints`, {
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (response.status === 404) return null;
      if (!response.ok) return undefined;
      const { data } = (await response.json()) as {
        data?: {
          name?: string;
          endpoints?: {
            context_length?: number;
            pricing?: { prompt?: string; completion?: string };
          }[];
        };
      };
      const perMillion = (usd?: string) => Math.round(Number(usd) * 1e12) / 1e6;
      const endpoints = (data?.endpoints ?? []).filter((e) => e.context_length);
      if (!data?.name || !endpoints.length) return null;
      // Providers' prices differ widely (Kimi K3: $5.50 to $24 output). Show a
      // typical one: the median provider by blended price, 3 input : 1 output.
      const priced = endpoints
        .map((e) => ({
          input: perMillion(e.pricing?.prompt),
          output: perMillion(e.pricing?.completion),
        }))
        .filter((p) => Number.isFinite(p.input) && Number.isFinite(p.output))
        .sort((a, b) => 3 * a.input + a.output - (3 * b.input + b.output));
      const pricing = priced[Math.floor((priced.length - 1) / 2)];
      return {
        id,
        name: data.name,
        contextWindow: Math.max(...endpoints.map((e) => e.context_length!)),
        ...(pricing ? { pricing } : {}),
      };
    } catch {
      return undefined;
    }
  }
}
