import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AnthropicProvider } from "./anthropic.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAIProvider } from "./openai.ts";
import { apiKeyEnv, createProvider, knownProviders } from "./select.ts";

describe("createProvider", () => {
  it("builds each provider with its default model when the model is empty", () => {
    const anthropic = createProvider("anthropic", "", "sys");
    const openai = createProvider("openai", "", "sys");
    const gemini = createProvider("gemini", "", "sys");
    assert.ok(anthropic instanceof AnthropicProvider);
    assert.ok(openai instanceof OpenAIProvider);
    assert.ok(gemini instanceof GeminiProvider);
    assert.equal(anthropic.model(), "claude-opus-4-7");
    assert.equal(openai.model(), "gpt-5");
    assert.equal(gemini.model(), "gemini-3.5-flash-lite");
  });

  it("rejects an unknown name", () => {
    assert.throws(() => createProvider("nope", "", ""), /unknown provider/);
  });

  it("names the credential each provider checks", () => {
    assert.equal(apiKeyEnv("anthropic"), "ANTHROPIC_API_KEY");
    assert.equal(apiKeyEnv("openai"), "OPENAI_API_KEY");
    assert.equal(apiKeyEnv("gemini"), "GEMINI_API_KEY");
    assert.deepEqual(knownProviders, ["anthropic", "openai", "gemini"]);
  });
});
