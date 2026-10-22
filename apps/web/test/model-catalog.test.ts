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
  models: [
    {
      id: "anthropic/haiku",
      name: "Claude Haiku",
      provider: "openrouter",
      contextWindow: 100,
      maxOutputTokens: 50,
      reasoning: false,
      inputModalities: ["text"],
    },
    {
      id: "openai/gpt",
      name: "GPT",
      provider: "openrouter",
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
