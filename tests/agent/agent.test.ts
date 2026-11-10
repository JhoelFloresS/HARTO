import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { emptyUsage, hasToolResult, type Message, type Response } from "../../src/api/types.ts";
import type { CompactionStrategy } from "../../src/compact/strategy.ts";
import { captureSink } from "../../src/output.ts";
import { MockProvider } from "../../src/provider/mock.ts";
import { Registry, type Tool } from "../../src/tool/registry.ts";
import { writeFileTool } from "../../src/tool/write-file.ts";
import { Agent } from "../../src/agent/agent.ts";

const echoTool: Tool = {
  definition: () => ({ name: "echo", description: "echoes its input", inputSchema: {}, required: [] }),
  async execute(input) {
    return { result: input, isError: false };
  },
};

function textResponse(text: string, stopReason: Response["stopReason"] = "end_turn"): Response {
  return { stopReason, content: [{ type: "text", text }], usage: emptyUsage() };
}

function newTestAgent(provider: MockProvider, tools = new Registry()): { agent: Agent; output: () => string } {
  const captured = captureSink();
  const agent = new Agent(provider, "", tools, captured.sink);
  return { agent, output: captured.text };
}

function resultWithId(messages: Message[] | undefined, id: string): Message["content"][number] | undefined {
  if (!messages) return undefined;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_result" && block.toolUseId === id) return block;
    }
  }
  return undefined;
}

describe("Agent.send", () => {
  it("returns text on end_turn", async () => {
    const provider = new MockProvider([textResponse("hello there")]);
    const { agent } = newTestAgent(provider);
    const got = await agent.send("hi");
    assert.equal(got, "hello there");
    assert.equal(provider.calls(), 1);
    assert.equal(agent.getMessages().length, 2);
  });

  it("loops on tool use and feeds the result back", async () => {
    const provider = new MockProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", toolUseId: "t1", toolName: "echo", toolInput: `{"x":1}` }],
        usage: emptyUsage(),
      },
      textResponse("done"),
    ]);
    const tools = new Registry();
    tools.register(echoTool);
    const { agent } = newTestAgent(provider, tools);
    const got = await agent.send("do it");
    assert.equal(got, "done");
    assert.equal(provider.calls(), 2);
    const block = resultWithId(provider.lastSent(), "t1");
    assert.ok(block);
    assert.equal(hasToolResult({ role: "user", content: [block] }), true);
    assert.equal(block.toolResult, `{"x":1}`);
    assert.equal(block.isError, false);
  });

  it("stops at maxTurns", async () => {
    const provider = new MockProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", toolUseId: "t", toolName: "echo", toolInput: "{}" }],
        usage: emptyUsage(),
      },
    ]);
    provider.repeatLast = true;
    const tools = new Registry();
    tools.register(echoTool);
    const { agent } = newTestAgent(provider, tools);
    agent.maxTurns = 3;
    await assert.rejects(agent.send("loop forever"), /max turns/);
    assert.equal(provider.calls(), 3);
  });

  it("propagates a provider error unchanged", async () => {
    const sentinel = new Error("provider exploded");
    const provider = new MockProvider();
    provider.err = sentinel;
    const { agent } = newTestAgent(provider);
    await assert.rejects(agent.send("hi"), (err: unknown) => err === sentinel);
  });

  it("keeps a denied tool from running and reports it as a tool result", async () => {
    const provider = new MockProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", toolUseId: "t1", toolName: "echo", toolInput: "{}" }],
        usage: emptyUsage(),
      },
      textResponse("ok"),
    ]);
    const tools = new Registry();
    tools.register({
      definition: echoTool.definition,
      async execute() {
        throw new Error("should not run");
      },
    });
    const { agent } = newTestAgent(provider, tools);
    agent.confirm = () => false;
    const got = await agent.send("nope");
    assert.equal(got, "ok");
    const block = resultWithId(provider.lastSent(), "t1");
    assert.equal(block?.toolResult, "user denied this tool call");
    assert.equal(block?.isError, true);
  });

  it("stores thought blocks but does not return them as the answer", async () => {
    const provider = new MockProvider([
      {
        stopReason: "end_turn",
        content: [
          { type: "text", text: "secret", providerMeta: { gemini: { thought: true } } },
          { type: "text", text: "visible" },
        ],
        usage: emptyUsage(),
      },
    ]);
    const { agent, output } = newTestAgent(provider);
    const got = await agent.send("hi");
    assert.equal(got, "visible");
    assert.equal(output().includes("secret"), false);
    assert.equal(output().includes("visible"), true);
    assert.equal(agent.getMessages()[1]?.content[0]?.text, "secret");
  });

  it("shows a diff and does not write when approval is denied", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harto-approve-"));
    const target = path.join(dir, "a.txt");
    await writeFile(target, "old\n");
    const provider = new MockProvider([
      {
        stopReason: "tool_use",
        content: [{
          type: "tool_use",
          toolUseId: "w",
          toolName: "write_file",
          toolInput: JSON.stringify({ path: target, content: "new\n" }),
        }],
        usage: emptyUsage(),
      },
      textResponse("done"),
    ]);
    const tools = new Registry();
    tools.register(writeFileTool);
    const { agent } = newTestAgent(provider, tools);
    let detail = "";
    agent.confirm = (_prompt, next) => {
      detail = next;
      return false;
    };
    assert.equal(await agent.send("write"), "done");
    assert.match(detail, /-old/);
    assert.match(detail, /\+new/);
    assert.equal(await readFile(target, "utf8"), "old\n");
  });

  it("continues when compaction throws", async () => {
    const provider = new MockProvider([textResponse("still here")]);
    const { agent } = newTestAgent(provider);
    const broken: CompactionStrategy = {
      async compact() {
        throw new Error("boom");
      },
    };
    agent.compactor = broken;
    const got = await agent.send("hi");
    assert.equal(got, "still here");
    assert.equal(provider.calls(), 1);
  });
});

describe("permissions and streaming", () => {
  it("runs an allowed tool without asking", async () => {
    const provider = new MockProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", toolUseId: "t1", toolName: "echo", toolInput: "{}" }],
        usage: emptyUsage(),
      },
      textResponse("done"),
    ]);
    const tools = new Registry();
    tools.register(echoTool);
    const { agent } = newTestAgent(provider, tools);
    let asked = false;
    agent.policy = { decide: () => ({ decision: "allow", reason: "" }) };
    agent.confirm = () => {
      asked = true;
      return false;
    };
    assert.equal(await agent.send("go"), "done");
    assert.equal(asked, false);
  });

  it("prints streamed text once, as it arrives", async () => {
    const deltas: string[] = [];
    const provider = new MockProvider([textResponse("hello")]);
    const send = provider.send.bind(provider);
    const streaming = {
      model: () => provider.model(),
      setModel: (name: string) => provider.setModel(name),
      async send(messages: Parameters<MockProvider["send"]>[0], tools: Parameters<MockProvider["send"]>[1], ctx?: Parameters<MockProvider["send"]>[2]) {
        const response = await send(messages, tools, ctx);
        ctx?.onText?.("hel");
        ctx?.onText?.("lo");
        return response;
      },
    };
    const captured = captureSink();
    const agent = new Agent(streaming, "", new Registry(), captured.sink);
    agent.onDelta = (delta) => deltas.push(delta);
    assert.equal(await agent.send("hi"), "hello");
    assert.deepEqual(deltas, ["hel", "lo", "\n"]);
    assert.equal(captured.text().includes("hello"), false);
  });
});
