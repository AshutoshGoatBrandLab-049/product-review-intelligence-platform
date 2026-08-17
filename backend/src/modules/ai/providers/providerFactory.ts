import { config } from "../../../config/index.js";
import { MockAiProvider } from "./mockAiProvider.js";
import { AnthropicProvider } from "./anthropicProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { OpenAiProvider } from "./openaiProvider.js";
import type { AiProvider } from "./aiProvider.js";

/**
 * Phase 4 §2 — the only place that reads config.ai.provider. Defaults to the
 * mock provider (config default), so the application never silently starts
 * making paid API calls just because it booted with an unset AI_PROVIDER.
 */
export function createAiProvider(): AiProvider {
  if (config.ai.provider === "anthropic") {
    return new AnthropicProvider(config.ai.anthropicApiKey, config.ai.anthropicModel);
  }
  if (config.ai.provider === "gemini") {
    return new GeminiProvider(config.ai.geminiApiKey, config.ai.geminiModel);
  }
  if (config.ai.provider === "openai") {
    return new OpenAiProvider(config.ai.openaiApiKey, config.ai.openaiModel);
  }
  return new MockAiProvider();
}
