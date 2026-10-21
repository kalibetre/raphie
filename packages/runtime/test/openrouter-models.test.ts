import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import {
  dynamicOpenRouterProvider,
  ModelCatalog,
  SqliteModelsStore,
} from "../src/domains/settings/infrastructure/openrouter-models.ts";

const bundled = openrouterProvider().getModels();
const day = 24 * 60 * 60 * 1000;

const listing = [
  {
    id: "zeta/new-model",
    name: "Zeta: New Model",
    context_length: 1000,
    architecture: {
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
    pricing: { prompt: "0.000001", completion: "0.000002" },
    top_provider: { context_length: 2000, max_completion_tokens: 500 },
    supported_parameters: ["tools", "reasoning"],
  },
  {
    id: "anthropic/claude-haiku-5.5",
    name: "Anthropic: Claude Haiku 5.5",
    context_length: 1000000,
    architecture: { output_modalities: ["text"] },
    pricing: { prompt: "0.0000002", completion: "0.000001" },
    supported_parameters: ["tools"],
  },
  {
    // Raphie needs tool calls; models without them are not added.
    id: "acme/no-tools",
    name: "Acme: No Tools",
    context_length: 1000,
    architecture: { output_modalities: ["text"] },
    supported_parameters: [],
  },
];

function fakeOpenRouter() {
  const state = { requests: 0, offline: false };
  const fetch = (async (url: string) => {
    expect(String(url)).toBe("https://openrouter.ai/api/v1/models/user");
    state.requests++;
    if (state.offline) throw new Error("offline");
    return Response.json({ data: listing });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, state };
}

async function setup(store: SqliteModelsStore, fetch: typeof globalThis.fetch) {
  const models = createModels({ modelsStore: store });
  // Pi refreshes dynamic lists only once a key resolves.
  models.setProvider({
    ...dynamicOpenRouterProvider(fetch),
    auth: {
      apiKey: {
        name: "test",
        resolve: async () => ({ auth: { apiKey: "k" } }),
      },
    },
  });
  return models;
}

test("Pi fetches, merges and persists OpenRouter's list; Raphie refetches weekly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-models-"));
  const store = await SqliteModelsStore.open(join(directory, "models.sqlite"));
  try {
    const remote = fakeOpenRouter();
    let now = Date.now();
    const models = await setup(store, remote.fetch);
    const catalog = new ModelCatalog(models, store, () => now);

    // Nothing cached: Pi's bundled list, and the first read waits for a fetch.
    expect(models.getModels("openrouter").length).toBe(bundled.length);
    expect(await catalog.fetchedAt()).toBeNull();
    await catalog.ensure();
    expect(remote.state.requests).toBe(1);

    const fresh = models.getModel("openrouter", "zeta/new-model")!;
    expect(fresh.api).toBe("openai-completions");
    expect(fresh.contextWindow).toBe(2000);
    expect(fresh.maxTokens).toBe(500);
    expect(fresh.input).toEqual(["text", "image"]);
    expect(fresh.cost).toMatchObject({ input: 1, output: 2 });
    const haiku = models.getModel("openrouter", "anthropic/claude-haiku-5.5")!;
    expect(haiku.api).toBe("anthropic-messages");
    expect(haiku.cost.input).toBe(0.2);
    expect(models.getModel("openrouter", "acme/no-tools")).toBeUndefined();

    // A restart restores the stored list without network access.
    const restarted = await setup(store, remote.fetch);
    const again = new ModelCatalog(restarted, store, () => now);
    await again.restore();
    await again.ensure();
    expect(restarted.getModel("openrouter", "zeta/new-model")).toBeDefined();
    expect(remote.state.requests).toBe(1);

    // After a week, one refetch; offline keeps the current list.
    now += 8 * day;
    await again.refresh();
    expect(remote.state.requests).toBe(2);
    remote.state.offline = true;
    expect(
      await again.refresh().then(
        () => "resolved",
        (error: Error) => error.message,
      ),
    ).toBe("offline");
    expect(restarted.getModel("openrouter", "zeta/new-model")).toBeDefined();
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
