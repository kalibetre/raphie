import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { defineAgent } from 'eve';

const mock = process.env.MODEL_MODE !== 'openrouter';
if (!mock && (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL)) {
  throw new Error('Set OPENROUTER_API_KEY and OPENROUTER_MODEL privately before selecting OpenRouter.');
}
const provider = createOpenAICompatible({
  name: mock ? 'raphie-mock' : 'openrouter',
  baseURL: mock ? 'http://127.0.0.1:4311/v1' : 'https://openrouter.ai/api/v1',
  apiKey: mock ? 'prototype-not-a-secret' : process.env.OPENROUTER_API_KEY,
  includeUsage: true,
});

export default defineAgent({
  model: provider(mock ? 'raphie-deterministic' : process.env.OPENROUTER_MODEL!),
  modelContextWindowTokens: 32_000,
  limits: { maxInputTokensPerSession: false, maxOutputTokensPerSession: false, maxTokenCostUsdPerSession: 0.25 },
  tool: false,
});
