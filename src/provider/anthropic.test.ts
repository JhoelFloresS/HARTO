import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isThoughtBlock } from "../api/types.ts";
import { Agent } from "../agent/agent.ts";
import { captureSink } from "../output.ts";
import { Registry } from "../tool/registry.ts";
import {
  AnthropicProvider,
  type AnthropicClient,
  type AnthropicRequest,
  type AnthropicResult,
} from "./anthropic.ts";

const readTool = {
  name: "read_file",
  description: "Read a file",
  inputSchema: { path: { type: "string" } },
  required: ["path"],
};

class FakeAnthropic implements AnthropicClient {
  readonly requests: AnthropicRequest[] = [];
  results: AnthropicResult[];

  constructor(results: AnthropicResult[]) {
    this.results = results.slice();
  }

  async create(request: AnthropicRequest): Promise<AnthropicResult> {
    this.requests.push(request);
    const next = this.results.shift();
    if (!next) throw new Error("fake anthropic has no result left");
    return next;
  }
}

function provider(fake: FakeAnthropic, system = "be brief"): AnthropicProvider {
  return new AnthropicProvider("claude-opus-4-7", system, fake);
}

describe("AnthropicProvider", () => {
  it("returns text and end_turn", async () => {
    const fake = new FakeAnthropic([{ stopReason: "end_turn", content: [{ type: "text", text: "hello" }] }]);
    const response = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(response.stopReason, "end_turn");
    assert.deepEqual(response.content, [{ type: "text", text: "hello" }]);
    assert.equal(fake.requests[0]?.system, "be brief");
    assert.equal(fake.requests[0]?.thinking.type, "adaptive");
    assert.equal(fake.requests[0]?.tools, undefined);
    assert.equal(fake.requests[0]?.messages[0]?.role, "user");
  });

  it("uses the system on this call when the shared provider was built with another", async () => {
    const fake = new FakeAnthropic([{ stopReason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
    await provider(fake, "root prompt").send(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      [],
      { system: "You are a research subagent." },
    );
    assert.equal(fake.requests[0]?.system, "You are a research subagent.");
  });

  it("maps a tool call and replays the result with its input object", async () => {
    const fake = new FakeAnthropic([
      {
        stopReason: "end_turn",
        content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } }],
      },
    ]);
    const first = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "read" }] }], [readTool]);
    assert.equal(first.stopReason, "tool_use");
    assert.equal(first.content[0]?.toolUseId, "toolu_1");
    assert.equal(first.content[0]?.toolInput, JSON.stringify({ path: "a.txt" }));
    assert.deepEqual(fake.requests[0]?.tools?.[0]?.input_schema, {
      type: "object",
      properties: readTool.inputSchema,
      required: ["path"],
    });

    fake.results.push({ stopReason: "end_turn", content: [{ type: "text", text: "done" }] });
    await provider(fake).send(
      [
        { role: "assistant", content: first.content },
        { role: "user", content: [{ type: "tool_result", toolUseId: "toolu_1", toolResult: "nope", isError: true }] },
      ],
      [readTool],
    );
    const replay = fake.requests[1]?.messages[1]?.content[0];
    assert.equal(replay?.type, "tool_result");
    if (replay?.type === "tool_result") {
      assert.equal(replay.tool_use_id, "toolu_1");
      assert.equal(replay.is_error, true);
      assert.equal(replay.content, "nope");
    }
    const call = fake.requests[1]?.messages[0]?.content[0];
    assert.equal(call?.type, "tool_use");
    if (call?.type === "tool_use") assert.deepEqual(call.input, { path: "a.txt" });
  });

  it("round-trips thinking and the loop does not show it", async () => {
    const fake = new FakeAnthropic([
      {
        stopReason: "end_turn",
        content: [
          { type: "thinking", thinking: "secret", signature: "sig1" },
          { type: "text", text: "visible" },
        ],
      },
      { stopReason: "end_turn", content: [{ type: "redacted_thinking", data: "blob" }, { type: "text", text: "next" }] },
      { stopReason: "end_turn", content: [{ type: "text", text: "last" }] },
    ]);
    const captured = captureSink();
    const agent = new Agent(provider(fake), "", new Registry(), captured.sink);
    assert.equal(await agent.send("hi"), "visible");
    assert.equal(captured.text().includes("secret"), false);
    const thought = agent.getMessages()[1]?.content[0];
    assert.equal(isThoughtBlock(thought!), true);

    assert.equal(await agent.send("again"), "next");
    const replayed = fake.requests[1]?.messages.find((message) => message.role === "assistant")?.content ?? [];
    assert.deepEqual(
      replayed.find((block) => block.type === "thinking"),
      { type: "thinking", thinking: "secret", signature: "sig1" },
    );

    assert.equal(await agent.send("third"), "last");
    const later = fake.requests[2]?.messages.flatMap((message) => message.content) ?? [];
    assert.deepEqual(
      later.find((block) => block.type === "redacted_thinking"),
      { type: "redacted_thinking", data: "blob" },
    );
  });

  it("does not send another provider's thought as visible text", async () => {
    const fake = new FakeAnthropic([{ stopReason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
    await provider(fake).send(
      [
        {
          role: "assistant",
          content: [{ type: "text", text: "secret", providerMeta: { gemini: { thought: true } } }],
        },
      ],
      [],
    );
    const assistant = fake.requests[0]?.messages.find((message) => message.role === "assistant");
    assert.equal(assistant, undefined);
  });

  it("maps max_tokens to other", async () => {
    const fake = new FakeAnthropic([{ stopReason: "max_tokens", content: [{ type: "text", text: "cut" }] }]);
    const response = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(response.stopReason, "other");
    assert.equal(response.content[0]?.text, "cut");
  });

  it("prices input and cache as separate fields", async () => {
    const fake = new FakeAnthropic([
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "a" }],
        usage: { inputTokens: 1_000_000, outputTokens: 2, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 },
      },
    ]);
    const anthropic = provider(fake);
    await anthropic.send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.deepEqual(anthropic.totalUsage(), {
      inputTokens: 1_000_000,
      outputTokens: 2,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    const expected = (1_000_000 * 5 + 2 * 25 + 1_000_000 * 6.25 + 1_000_000 * 0.5) / 1_000_000;
    assert.ok(Math.abs(anthropic.estimatedCostUsd() - expected) < 1e-9);
    anthropic.setModel("not-a-model");
    assert.equal(anthropic.estimatedCostUsd(), -1);
  });

  it("rejects a tool_use whose input is not a JSON object and does not call the client", async () => {
    const fake = new FakeAnthropic([]);
    await assert.rejects(
      provider(fake).send(
        [{ role: "assistant", content: [{ type: "tool_use", toolUseId: "t", toolName: "read_file", toolInput: "not-json" }] }],
        [],
      ),
      /invalid tool input JSON/,
    );
    assert.equal(fake.requests.length, 0);
  });

  it("omits an empty system prompt", async () => {
    const fake = new FakeAnthropic([{ stopReason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
    await provider(fake, "").send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(fake.requests[0]?.system, undefined);
  });
});
