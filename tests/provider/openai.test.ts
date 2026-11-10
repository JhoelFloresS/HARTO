import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OpenAIProvider,
  type OpenAIClient,
  type OpenAIMessage,
  type OpenAIRequest,
  type OpenAIResult,
} from "../../src/provider/openai.ts";

const readTool = {
  name: "read_file",
  description: "Read a file",
  inputSchema: { path: { type: "string" } },
  required: ["path"],
};

class FakeOpenAI implements OpenAIClient {
  readonly requests: OpenAIRequest[] = [];
  results: OpenAIResult[];

  constructor(results: OpenAIResult[]) {
    this.results = results.slice();
  }

  async create(request: OpenAIRequest): Promise<OpenAIResult> {
    this.requests.push(request);
    const next = this.results.shift();
    if (!next) throw new Error("fake openai has no result left");
    return next;
  }
}

function provider(fake: FakeOpenAI, system = "be brief"): OpenAIProvider {
  return new OpenAIProvider("gpt-5", system, fake);
}

function assistant(messages: OpenAIMessage[]): Extract<OpenAIMessage, { role: "assistant" }> | undefined {
  return messages.find((message) => message.role === "assistant") as Extract<OpenAIMessage, { role: "assistant" }> | undefined;
}

describe("OpenAIProvider", () => {
  it("returns text and end_turn, with the system prompt in front", async () => {
    const fake = new FakeOpenAI([{ finishReason: "stop", content: "hello" }]);
    const response = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(response.stopReason, "end_turn");
    assert.deepEqual(response.content, [{ type: "text", text: "hello" }]);
    assert.deepEqual(fake.requests[0]?.messages[0], { role: "system", content: "be brief" });
    assert.deepEqual(fake.requests[0]?.messages[1], { role: "user", content: "hi" });
    assert.equal(fake.requests[0]?.tools, undefined);
    assert.equal(fake.requests[0]?.maxCompletionTokens, 8192);
  });

  it("uses the system on this call when the shared provider was built with another", async () => {
    const fake = new FakeOpenAI([{ finishReason: "stop", content: "ok" }]);
    await provider(fake, "root prompt").send(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      [],
      { system: "You are a research subagent." },
    );
    assert.deepEqual(fake.requests[0]?.messages[0], { role: "system", content: "You are a research subagent." });
  });

  it("splits tool results into their own messages and keeps tool calls on the assistant", async () => {
    const fake = new FakeOpenAI([
      {
        finishReason: "stop",
        content: "looking",
        toolCalls: [{ id: "call_1", name: "read_file", arguments: "{\"path\":\"a.txt\"}" }],
      },
    ]);
    const first = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "read" }] }], [readTool]);
    assert.equal(first.stopReason, "tool_use");
    assert.equal(first.content[0]?.text, "looking");
    assert.equal(first.content[1]?.toolUseId, "call_1");
    assert.equal(first.content[1]?.toolInput, "{\"path\":\"a.txt\"}");
    assert.deepEqual(fake.requests[0]?.tools?.[0]?.parameters, {
      type: "object",
      properties: readTool.inputSchema,
      required: ["path"],
    });

    fake.results.push({ finishReason: "stop", content: "done" });
    await provider(fake).send(
      [
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            { type: "text", text: "note" },
            { type: "tool_result", toolUseId: "call_1", toolResult: "body" },
          ],
        },
      ],
      [readTool],
    );
    const messages = fake.requests[1]?.messages ?? [];
    assert.deepEqual(assistant(messages), {
      role: "assistant",
      content: "looking",
      toolCalls: [{ id: "call_1", name: "read_file", arguments: "{\"path\":\"a.txt\"}" }],
    });
    const note = messages.findIndex((message) => message.role === "user" && message.content === "note");
    assert.ok(note >= 0);
    assert.deepEqual(messages[note + 1], { role: "tool", toolCallId: "call_1", content: "body" });
  });

  it("omits required when the tool has none", async () => {
    const fake = new FakeOpenAI([{ finishReason: "stop", content: "ok" }]);
    await provider(fake).send([{ role: "user", content: [{ type: "text", text: "hi" }] }], [
      { name: "ping", description: "Ping", inputSchema: {}, required: [] },
    ]);
    assert.equal(fake.requests[0]?.tools?.[0]?.parameters.required, undefined);
  });

  it("maps an empty choice list to other", async () => {
    const fake = new FakeOpenAI([{ empty: true, usage: { promptTokens: 3 } }]);
    const response = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(response.stopReason, "other");
    assert.deepEqual(response.content, []);
    assert.equal(response.usage.inputTokens, 3);
  });

  it("maps length to other", async () => {
    const fake = new FakeOpenAI([{ finishReason: "length", content: "cut" }]);
    const response = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(response.stopReason, "other");
  });

  it("does not send a thought block as assistant text", async () => {
    const fake = new FakeOpenAI([{ finishReason: "stop", content: "ok" }]);
    await provider(fake, "").send(
      [
        {
          role: "assistant",
          content: [
            { type: "text", text: "secret", providerMeta: { anthropic: { thought: true } } },
            { type: "text", text: "visible" },
          ],
        },
      ],
      [],
    );
    assert.equal(fake.requests[0]?.messages[0]?.role, "assistant");
    assert.equal(assistant(fake.requests[0]?.messages ?? [])?.content, "visible");
  });

  it("prices fresh input apart from cache reads", async () => {
    const fake = new FakeOpenAI([
      {
        finishReason: "stop",
        content: "a",
        usage: { promptTokens: 1_000_000, completionTokens: 4, cachedTokens: 400_000 },
      },
    ]);
    const openai = provider(fake);
    await openai.send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    const expected = (600_000 * 1.25 + 4 * 10 + 400_000 * 0.125) / 1_000_000;
    assert.ok(Math.abs(openai.estimatedCostUsd() - expected) < 1e-9);
    openai.setModel("o3-mini");
    assert.equal(openai.estimatedCostUsd(), -1);
  });

  it("propagates a client error", async () => {
    const boom = new Error("no key");
    const broken: OpenAIClient = {
      async create() {
        throw boom;
      },
    };
    await assert.rejects(new OpenAIProvider("gpt-5", "", broken).send([], []), (err: unknown) => err === boom);
  });
});
