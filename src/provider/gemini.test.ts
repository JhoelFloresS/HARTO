import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isThoughtBlock } from "../api/types.ts";
import { Agent } from "../agent/agent.ts";
import { captureSink } from "../output.ts";
import { Registry } from "../tool/registry.ts";
import {
  GeminiProvider,
  type GeminiClient,
  type GeminiRequest,
  type GeminiResult,
} from "./gemini.ts";

const readTool = {
  name: "read_file",
  description: "Read a file",
  inputSchema: { path: { type: "string" } },
  required: ["path"],
};

class FakeGemini implements GeminiClient {
  readonly requests: GeminiRequest[] = [];
  results: GeminiResult[];

  constructor(results: GeminiResult[]) {
    this.results = results.slice();
  }

  async generateContent(request: GeminiRequest): Promise<GeminiResult> {
    this.requests.push(request);
    const next = this.results.shift();
    if (!next) throw new Error("fake gemini has no result left");
    return next;
  }
}

function provider(fake: FakeGemini, system = "be brief"): GeminiProvider {
  return new GeminiProvider("gemini-3.5-flash-lite", system, fake);
}

describe("GeminiProvider", () => {
  it("returns text and end_turn", async () => {
    const fake = new FakeGemini([{ finishReason: "STOP", parts: [{ text: "hello" }] }]);
    const response = await provider(fake).send(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      [],
    );
    assert.equal(response.stopReason, "end_turn");
    assert.deepEqual(response.content, [{ type: "text", text: "hello" }]);
    assert.equal(fake.requests[0]?.systemInstruction, "be brief");
    assert.equal(fake.requests[0]?.contents[0]?.role, "user");
  });

  it("uses the system on this call when the shared provider was built with another", async () => {
    const fake = new FakeGemini([{ finishReason: "STOP", parts: [{ text: "ok" }] }]);
    await provider(fake, "root prompt").send(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      [],
      { system: "You are a research subagent." },
    );
    assert.equal(fake.requests[0]?.systemInstruction, "You are a research subagent.");
  });

  it("synthesizes an id when functionCall has none and replays the result", async () => {
    const fake = new FakeGemini([
      { finishReason: "STOP", parts: [{ functionCall: { name: "read_file", args: { path: "a.txt" } } }] },
      { finishReason: "STOP", parts: [{ text: "done" }] },
    ]);
    const gemini = provider(fake);
    const first = await gemini.send([{ role: "user", content: [{ type: "text", text: "read" }] }], [readTool]);
    assert.equal(first.stopReason, "tool_use");
    assert.equal(first.content[0]?.toolUseId, "call_0");
    assert.equal(first.content[0]?.toolName, "read_file");
    assert.equal(first.content[0]?.toolInput, JSON.stringify({ path: "a.txt" }));

    await gemini.send(
      [
        { role: "user", content: [{ type: "text", text: "read" }] },
        { role: "assistant", content: first.content },
        { role: "user", content: [{ type: "tool_result", toolUseId: "call_0", toolResult: "file body" }] },
      ],
      [readTool],
    );
    const replay = fake.requests[1]?.contents.find((content) => content.role === "user" && content.parts.some((part) => part.functionResponse));
    const fn = replay?.parts.find((part) => part.functionResponse)?.functionResponse;
    assert.equal(fn?.name, "read_file");
    assert.equal(fn?.id, "call_0");
    assert.deepEqual(fn?.response, { output: "file body" });
  });

  it("keeps a functionCall id on the way back", async () => {
    const fake = new FakeGemini([
      { finishReason: "STOP", parts: [{ functionCall: { id: "abc", name: "read_file", args: {} } }] },
    ]);
    const first = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "go" }] }], [readTool]);
    assert.equal(first.content[0]?.toolUseId, "abc");
    fake.results.push({ finishReason: "STOP", parts: [{ text: "ok" }] });
    await provider(fake).send(
      [
        { role: "assistant", content: first.content },
        { role: "user", content: [{ type: "tool_result", toolUseId: "abc", toolResult: "x", isError: true }] },
      ],
      [readTool],
    );
    const fn = fake.requests.at(-1)?.contents.flatMap((content) => content.parts).find((part) => part.functionResponse)?.functionResponse;
    assert.equal(fn?.id, "abc");
    assert.deepEqual(fn?.response, { error: "x" });
  });

  it("treats STOP plus a functionCall as tool_use", async () => {
    const fake = new FakeGemini([
      { finishReason: "STOP", parts: [{ text: "looking" }, { functionCall: { name: "read_file", args: {} } }] },
    ]);
    const response = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "go" }] }], [readTool]);
    assert.equal(response.stopReason, "tool_use");
  });

  it("round-trips a thought signature and the loop does not show the thought", async () => {
    const fake = new FakeGemini([
      {
        finishReason: "STOP",
        parts: [
          { text: "secret", thought: true, thoughtSignature: "sig1" },
          { text: "visible" },
        ],
      },
      { finishReason: "STOP", parts: [{ text: "next" }] },
    ]);
    const captured = captureSink();
    const agent = new Agent(provider(fake), "", new Registry(), captured.sink);
    assert.equal(await agent.send("hi"), "visible");
    assert.equal(captured.text().includes("secret"), false);
    const thought = agent.getMessages()[1]?.content[0];
    assert.equal(isThoughtBlock(thought!), true);
    assert.equal(await agent.send("again"), "next");
    const model = fake.requests[1]?.contents.find((content) => content.role === "model");
    assert.equal(model?.parts[0]?.text, "secret");
    assert.equal(model?.parts[0]?.thought, true);
    assert.equal(model?.parts[0]?.thoughtSignature, "sig1");
  });

  it("omits function declarations when there are no tools", async () => {
    const fake = new FakeGemini([{ finishReason: "STOP", parts: [{ text: "ok" }] }]);
    await provider(fake, "").send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(fake.requests[0]?.functionDeclarations, undefined);
    assert.equal(fake.requests[0]?.systemInstruction, undefined);
  });

  it("explains a SAFETY block that has no text", async () => {
    const fake = new FakeGemini([{ finishReason: "SAFETY", parts: [] }]);
    const response = await provider(fake).send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(response.stopReason, "other");
    assert.equal(response.content[0]?.text, "gemini: SAFETY");
  });

  it("accumulates usage and prices fresh input apart from cache reads", async () => {
    const fake = new FakeGemini([
      {
        finishReason: "STOP",
        parts: [{ text: "a" }],
        usage: { promptTokenCount: 1_000_000, candidatesTokenCount: 10, thoughtsTokenCount: 5, cachedContentTokenCount: 0 },
      },
      {
        finishReason: "STOP",
        parts: [{ text: "b" }],
        usage: { promptTokenCount: 1_000_000, candidatesTokenCount: 0, cachedContentTokenCount: 1_000_000 },
      },
    ]);
    const gemini = provider(fake);
    const first = await gemini.send([{ role: "user", content: [{ type: "text", text: "hi" }] }], []);
    assert.equal(first.usage.inputTokens, 1_000_000);
    assert.equal(first.usage.outputTokens, 15);
    assert.equal(first.usage.cacheCreationTokens, 0);
    assert.equal(first.usage.cacheReadTokens, 0);
    await gemini.send([{ role: "user", content: [{ type: "text", text: "again" }] }], []);
    assert.deepEqual(gemini.totalUsage(), {
      inputTokens: 2_000_000,
      outputTokens: 15,
      cacheCreationTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    // 1M fresh input at $0.30 plus 1M cache read at $0.03 plus 15 output tokens.
    const expected = (1_000_000 * 0.3 + 15 * 2.5 + 1_000_000 * 0.03) / 1_000_000;
    assert.ok(Math.abs(gemini.estimatedCostUsd() - expected) < 1e-9);
    gemini.setModel("not-a-model");
    assert.equal(gemini.estimatedCostUsd(), -1);
  });

  it("rejects a tool_use whose input is not JSON", async () => {
    const fake = new FakeGemini([]);
    await assert.rejects(
      provider(fake).send(
        [{ role: "assistant", content: [{ type: "tool_use", toolUseId: "t", toolName: "read_file", toolInput: "not-json" }] }],
        [],
      ),
      /not valid JSON/,
    );
    assert.equal(fake.requests.length, 0);
  });
});
