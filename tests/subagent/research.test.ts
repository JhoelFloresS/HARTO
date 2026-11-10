import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { emptyUsage, type Response, type ToolDef } from "../../src/api/types.ts";
import { captureSink } from "../../src/output.ts";
import { MockProvider } from "../../src/provider/mock.ts";
import type { Provider, SendContext } from "../../src/provider/provider.ts";
import { Registry } from "../../src/tool/registry.ts";
import { readFileTool } from "../../src/tool/read-file.ts";
import { Research } from "../../src/subagent/research.ts";
import { activeSubagents, clearActiveSubagents } from "../../src/subagent/tracker.ts";

function text(text: string): Response {
  return { stopReason: "end_turn", content: [{ type: "text", text }], usage: emptyUsage() };
}

describe("research", () => {
  afterEach(() => {
    clearActiveSubagents();
  });

  it("returns the final text and does not print it", async () => {
    const provider = new MockProvider([text("src/agent/agent.ts owns the loop")]);
    const captured = captureSink();
    const tools = new Registry();
    tools.register(readFileTool);
    const research = new Research(provider, tools, captured.sink);

    const answer = await research.run("where is the loop");

    assert.equal(answer, "src/agent/agent.ts owns the loop");
    assert.equal(captured.text(), "");
    assert.deepEqual(activeSubagents(), []);
    assert.deepEqual(
      provider.toolsAt(0)?.map((tool) => tool.name),
      ["read_file"],
    );
    const sent = provider.sentAt(0);
    assert.equal(sent?.[0]?.content[0]?.text, "where is the loop");
    assert.match(provider.systemAt(0) ?? "", /research subagent/);
  });

  it("prefixes tool lines and stays quiet about the answer", async () => {
    const provider = new MockProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", toolUseId: "c1", toolName: "read_file", toolInput: "{\"path\":\"src/a.ts\"}" }],
        usage: emptyUsage(),
      },
      text("the export is Agent"),
    ]);
    const captured = captureSink();
    const tools = new Registry();
    tools.register(readFileTool);
    const research = new Research(provider, tools, captured.sink);

    const answer = await research.run("what does it export");

    assert.equal(answer, "the export is Agent");
    assert.match(captured.text(), / {2}↳ \[tool\] read_file/);
    assert.doesNotMatch(captured.text(), /the export is Agent/);
  });

  it("stops after 10 turns and still clears the tracker", async () => {
    const provider = new MockProvider([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", toolUseId: "c1", toolName: "read_file", toolInput: "{}" }],
        usage: emptyUsage(),
      },
    ]);
    provider.repeatLast = true;
    const research = new Research(provider, new Registry(), captureSink().sink);

    await assert.rejects(research.run("keep going"), /max turns \(10\) reached/);
    assert.equal(provider.calls(), 10);
    assert.deepEqual(activeSubagents(), []);
  });

  it("counts overlapping runs", async () => {
    let started = 0;
    let seen = 0;
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocking: Provider = {
      async send(_messages: unknown, _tools: ToolDef[], _ctx?: SendContext): Promise<Response> {
        started += 1;
        if (started === 2) {
          seen = activeSubagents().find((item) => item.name === "research")?.count ?? 0;
          release();
        } else {
          await hold;
        }
        return text("ok");
      },
      model: () => "mock",
      setModel() {},
    };
    const first = new Research(blocking, new Registry());
    const second = new Research(blocking, new Registry());

    const pending = Promise.all([first.run("a"), second.run("b")]);
    await pending;

    assert.equal(seen, 2);
    assert.deepEqual(activeSubagents(), []);
  });
});
