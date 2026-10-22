import { test, expect } from "bun:test";

import {
  filterModels,
  modelSource,
  type LibraryModel,
} from "../src/domains/settings/application/model-library";

const claude: LibraryModel = {
  id: "anthropic/claude",
  name: "Anthropic: Claude",
  provider: "openrouter",
  contextWindow: 200000,
  maxOutputTokens: 32000,
  reasoning: true,
  inputModalities: ["text", "image"],
};
const gpt: LibraryModel = {
  ...claude,
  id: "openai/gpt",
  name: "OpenAI: GPT",
  provider: "openrouter",
};
const direct: LibraryModel = { ...gpt, id: "gpt", provider: "openai" };
const models = [claude, gpt, direct];

test("model library keeps serving providers distinct from model sources and intersects filters", () => {
  expect(filterModels(models, "", "openrouter", "openai")).toEqual([gpt]);
  expect(filterModels(models, "", "openai", "openai")).toEqual([direct]);
  expect(filterModels(models, "  CLAUDE  ", "all", "anthropic")).toEqual([
    claude,
  ]);
  expect(filterModels(models, "gpt", "openrouter", "anthropic")).toEqual([]);
  expect(filterModels(models, "", "all", "all")).toEqual(models);
  expect(filterModels([], "", "all", "all")).toEqual([]);
});

test("source filters group Pi latest aliases with the same vendor", () => {
  const alias = { ...claude, id: "~anthropic/claude-latest" };
  expect(modelSource(alias)).toEqual({ id: "anthropic", label: "Anthropic" });
  expect(filterModels([alias], "", "openrouter", "anthropic")).toEqual([alias]);
  expect(modelSource({ ...gpt, id: "auto", name: "Auto" })).toEqual({
    id: "openrouter",
    label: "OpenRouter",
  });
});
