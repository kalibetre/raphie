import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import {
  CURATED_MODELS,
  OpenRouterCatalog,
} from "../src/domains/settings/infrastructure/openrouter-catalog.ts";

const models = createModels();
models.setProvider(openrouterProvider());
const [haiku, sonnet] = CURATED_MODELS;

function fakeOpenRouter() {
  const requested: string[] = [];
  const fetch = (async (url: string) => {
    const id = url.replace(/^.*\/models\//, "").replace(/\/endpoints$/, "");
    requested.push(id);
    if (id === sonnet) return new Response("{}", { status: 404 });
    if (id === "offline/model") throw new Error("offline");
    return Response.json({
      data: {
        name: `Fresh ${id}`,
        endpoints: [
          // Unordered providers; the median by blended price is shown.
          {
            context_length: 4242,
            pricing: { prompt: "0.000003", completion: "0.000015" },
          },
          {
            context_length: 4000,
            pricing: { prompt: "0.0000001", completion: "0.0000005" },
          },
          {
            context_length: 4000,
            pricing: { prompt: "0.00000005", completion: "0.000024" },
          },
        ],
      },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requested };
}

test("lists curated Pi-runnable models, refreshed from OpenRouter and cached on disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-catalog-"));
  try {
    const path = join(directory, "openrouter-models.json");
    const remote = fakeOpenRouter();
    let now = 1_000_000_000;
    const catalog = await new OpenRouterCatalog({
      path,
      models,
      fetch: remote.fetch,
      now: () => now,
    }).load();

    // Before any refresh: Pi's bundled metadata, unknown ids skipped.
    const first = catalog.list(["not-in-pi/model"]);
    expect(first.map((m) => m.id)).toContain(haiku);
    expect(first.map((m) => m.id)).not.toContain("not-in-pi/model");

    await catalog.refresh();
    // One request per curated model, never the full catalog.
    expect(remote.requested.length).toBe(CURATED_MODELS.length);
    const fresh = catalog.list();
    const haikuMeta = fresh.find((m) => m.id === haiku)!;
    expect(haikuMeta.name).toBe(`Fresh ${haiku}`);
    expect(haikuMeta.contextWindow).toBe(4242);
    expect(haikuMeta.pricing).toEqual({ input: 3, output: 15 });
    // Gone from OpenRouter: hidden, unless a session still uses it.
    expect(fresh.map((m) => m.id)).not.toContain(sonnet);
    expect(catalog.list([sonnet]).map((m) => m.id)).toContain(sonnet);

    // A restart reads the cache without refetching while it is fresh.
    const restarted = await new OpenRouterCatalog({
      path,
      models,
      fetch: remote.fetch,
      now: () => now,
    }).load();
    const before = remote.requested.length;
    expect(restarted.list().find((m) => m.id === haiku)!.contextWindow).toBe(
      4242,
    );
    expect(remote.requested.length).toBe(before);
    expect(JSON.parse(await readFile(path, "utf8")).models[sonnet]).toBeNull();

    // After a day, reading triggers one background refresh.
    now += 25 * 60 * 60 * 1000;
    restarted.list();
    await restarted.refresh();
    expect(remote.requested.length).toBe(before + CURATED_MODELS.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("network failures keep cached metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-catalog-"));
  try {
    const path = join(directory, "openrouter-models.json");
    const catalog = await new OpenRouterCatalog({
      path,
      models,
      fetch: fakeOpenRouter().fetch,
    }).load();
    await catalog.refresh();
    const offline = await new OpenRouterCatalog({
      path,
      models,
      fetch: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
      now: () => Date.now() + 2 * 24 * 60 * 60 * 1000,
    }).load();
    await offline.refresh();
    expect(offline.list().find((m) => m.id === haiku)!.name).toBe(
      `Fresh ${haiku}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
