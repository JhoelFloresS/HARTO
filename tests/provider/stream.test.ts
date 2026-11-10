import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyUsage } from "../../src/api/types.ts";
import { AnthropicProvider, type AnthropicClient } from "../../src/provider/anthropic.ts";
import { GeminiProvider, type GeminiClient } from "../../src/provider/gemini.ts";
import { OpenAIProvider, type OpenAIClient } from "../../src/provider/openai.ts";

describe("provider streaming", () => {
  it("uses the stream client when onText is set and create otherwise", async () => {
    let created = 0;
    const client: AnthropicClient = {
      async create() {
        created += 1;
        return { content: [{ type: "text", text: "full" }], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
      async stream(_request, onText) {
        onText("a");
        onText("b");
        return { content: [{ type: "text", text: "ab" }], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const provider = new AnthropicProvider("claude-opus-4-7", "", client);
    const deltas: string[] = [];
    const streamed = await provider.send([], [], { onText: (delta) => deltas.push(delta) });
    assert.deepEqual(deltas, ["a", "b"]);
    assert.equal(streamed.content[0]?.text, "ab");
    await provider.send([], []);
    assert.equal(created, 1);
    assert.equal(streamed.usage.inputTokens, 1);
    assert.equal(emptyUsage().inputTokens, 0);
  });

  it("streams OpenAI and Gemini text the same way", async () => {
    const openai: OpenAIClient = {
      async create() {
        return { content: "no" };
      },
      async stream(_request, onText) {
        onText("yo");
        return { content: "yo", finishReason: "stop", usage: { promptTokens: 2, completionTokens: 1 } };
      },
    };
    const gemini: GeminiClient = {
      async generateContent() {
        return { parts: [{ text: "no" }], finishReason: "STOP" };
      },
      async stream(_request, onText) {
        onText("ya");
        return { parts: [{ text: "ya" }], finishReason: "STOP", usage: { promptTokenCount: 2, candidatesTokenCount: 1 } };
      },
    };
    const openDeltas: string[] = [];
    const geminiDeltas: string[] = [];
    const open = await new OpenAIProvider("gpt-5", "", openai).send([], [], { onText: (delta) => openDeltas.push(delta) });
    const gem = await new GeminiProvider("gemini-3.5-flash-lite", "", gemini).send([], [], { onText: (delta) => geminiDeltas.push(delta) });
    assert.deepEqual(openDeltas, ["yo"]);
    assert.equal(open.content[0]?.text, "yo");
    assert.deepEqual(geminiDeltas, ["ya"]);
    assert.equal(gem.content[0]?.text, "ya");
  });
});
