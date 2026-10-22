import { test } from "bun:test";
import assert from "node:assert/strict";

import type { RuntimeSettings } from "@raphie/contracts";

import { modelCatalog } from "../src/domains/conversations/application/model-catalog.ts";

const settings: RuntimeSettings = {
  telemetryEnabled: true,
  provider: "openrouter",
  providerEnabled: true,
  credentialSource: "saved",
  modelId: "anthropic/haiku",
  providers: [{ id: "openrouter", name: "OpenRouter" }],
  connections: [
    {
      id: "openrouter",
      provider: "openrouter",
      name: "OpenRouter",
      credentialSource: "saved",
    },
  ],
  models: [
    {
      id: "anthropic/haiku",
      name: "Claude Haiku",
      provider: "openrouter",
      connectionId: "openrouter",
      connectionName: "OpenRouter",
      contextWindow: 100,
      maxOutputTokens: 50,
      reasoning: false,
      inputModalities: ["text"],
    },
    {
      id: "openai/gpt",
      name: "GPT",
      provider: "openrouter",
      connectionId: "openrouter",
      connectionName: "OpenRouter",
      contextWindow: 200,
      maxOutputTokens: 50,
      reasoning: true,
      inputModalities: ["text"],
    },
  ],
};

test("model discovery combines search and filters without treating another provider’s favorites as connected", () => {
  assert.deepEqual(
    modelCatalog(settings, "  CLAUDE ", "all", []).matching.map((m) => m.id),
    ["anthropic/haiku"],
  );
  assert.deepEqual(modelCatalog(settings, "gpt", "anthropic", []).matching, []);
  assert.deepEqual(
    modelCatalog(settings, "", "favorites", ["other:anthropic/haiku"]).matching,
    [],
  );
  assert.deepEqual(
    modelCatalog(settings, "", "favorites", [
      "openrouter:openai/gpt",
    ]).matching.map((m) => m.id),
    ["openai/gpt"],
  );
  assert.deepEqual(modelCatalog(settings, "", "all", []).families, [
    "anthropic",
    "openai",
  ]);
  assert.deepEqual(modelCatalog(undefined, "", "all", []).matching, []);
});

test("favorites and search retain the identity of two connections to the same provider", () => {
  const personal = {
    ...settings.models[0]!,
    connectionId: "personal",
    connectionName: "Personal",
  };
  const work = { ...personal, connectionId: "work", connectionName: "Work" };
  const data = { ...settings, models: [personal, work] };
  assert.deepEqual(
    modelCatalog(data, "", "favorites", ["work:anthropic/haiku"]).matching,
    [work],
  );
  assert.deepEqual(modelCatalog(data, "personal", "all", []).matching, [
    personal,
  ]);
});
