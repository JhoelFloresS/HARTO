import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OpenRouterProvider } from "../../src/provider/openrouter.ts";
import type { OpenAIClient, OpenAIRequest, OpenAIResult } from "../../src/provider/openai.ts";

class FakeChat implements OpenAIClient {
  readonly requests: OpenAIRequest[] = [];
  results: OpenAIResult[];

  constructor(results: OpenAIResult[]) {
    this.results = results.slice();
  }

  async create(request: OpenAIRequest): Promise<OpenAIResult> {
    this.requests.push(request);
    const next = this.results.shift();
    if (!next) throw new Error("fake openrouter has no result left");
    return next;
  }
}

describe("OpenRouterProvider", () => {
  it("sends the slug and maps a tool call, without inventing a price", async () => {
    const fake = new FakeChat([
      {
        finishReason: "tool_calls",
        content: "looking",
        toolCalls: [{ id: "call_1", name: "read_file", arguments: "{\"path\":\"a.txt\"}" }],
        usage: { promptTokens: 10, completionTokens: 4, cachedTokens: 2 },
      },
    ]);
    const provider = new OpenRouterProvider("anthropic/claude-sonnet-4.6", "be brief", fake);
    const response = await provider.send([{ role: "user", content: [{ type: "text", text: "read" }] }], [
      { name: "read_file", description: "Read a file", inputSchema: { path: { type: "string" } }, required: ["path"] },
    ]);
    assert.equal(response.stopReason, "tool_use");
    assert.equal(response.content[1]?.toolName, "read_file");
    assert.equal(fake.requests[0]?.model, "anthropic/claude-sonnet-4.6");
    assert.deepEqual(fake.requests[0]?.messages[0], { role: "system", content: "be brief" });
    assert.equal(provider.estimatedCostUsd(), -1);
    assert.equal(provider.totalUsage().inputTokens, 10);
    assert.equal(provider.totalUsage().cacheReadTokens, 2);
  });

  it("streams when the caller wants text as it arrives", async () => {
    const fake: OpenAIClient = {
      async create() {
        throw new Error("create should not run");
      },
      async stream(request, onText) {
        assert.equal(request.model, "openai/gpt-5-mini");
        onText("ho");
        onText("la");
        return { content: "hola", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 } };
      },
    };
    const deltas: string[] = [];
    const provider = new OpenRouterProvider("", "", fake);
    const response = await provider.send([], [], { onText: (delta) => deltas.push(delta) });
    assert.deepEqual(deltas, ["ho", "la"]);
    assert.equal(response.content[0]?.text, "hola");
    assert.equal(provider.model(), "openai/gpt-5-mini");
  });
});
