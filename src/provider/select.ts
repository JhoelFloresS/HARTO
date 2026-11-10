import { AnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "./anthropic.ts";
import { GeminiProvider, GEMINI_DEFAULT_MODEL } from "./gemini.ts";
import { OpenAIProvider, OPENAI_DEFAULT_MODEL } from "./openai.ts";
import { OpenRouterProvider, OPENROUTER_DEFAULT_MODEL } from "./openrouter.ts";
import type { Provider } from "./provider.ts";

export const knownProviders = ["anthropic", "openai", "gemini", "openrouter"] as const;

export type ProviderName = (typeof knownProviders)[number];

export const knownModels: Record<ProviderName, readonly string[]> = {
  anthropic: ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  openai: ["gpt-5-codex", "gpt-5", "gpt-5-mini", "gpt-4o", "gpt-4o-mini", "o3-mini"],
  gemini: ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"],
  openrouter: [
    "openai/gpt-5-mini",
    "openai/gpt-5",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-haiku-4.5",
    "google/gemini-3.5-flash-lite",
  ],
};

export const defaultModel: Record<ProviderName, string> = {
  anthropic: ANTHROPIC_DEFAULT_MODEL,
  openai: OPENAI_DEFAULT_MODEL,
  gemini: GEMINI_DEFAULT_MODEL,
  openrouter: OPENROUTER_DEFAULT_MODEL,
};

export function apiKeyEnv(name: ProviderName): string {
  switch (name) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
  }
}

export function isProviderName(name: string): name is ProviderName {
  return (knownProviders as readonly string[]).includes(name);
}

/** Empty model picks the adapter default. Anthropic and OpenAI load their SDK on the first real send. */
export function createProvider(name: string, model: string, system: string): Provider {
  if (!isProviderName(name)) {
    throw new Error(`unknown provider ${JSON.stringify(name)} (try one of ${knownProviders.join(", ")})`);
  }
  const chosen = model === "" ? defaultModel[name] : model;
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(chosen, system);
    case "openai":
      return new OpenAIProvider(chosen, system);
    case "gemini":
      return new GeminiProvider(chosen, system);
    case "openrouter":
      return new OpenRouterProvider(chosen, system);
  }
}
