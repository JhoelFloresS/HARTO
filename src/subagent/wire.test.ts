import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyUsage } from "../api/types.ts";
import { captureSink } from "../output.ts";
import { MockProvider } from "../provider/mock.ts";
import { Registry } from "../tool/registry.ts";
import { readFileTool } from "../tool/read-file.ts";
import { writeFileTool } from "../tool/write-file.ts";
import { SubagentRegistry } from "./registry.ts";
import { registerSubagents } from "./wire.ts";

describe("registerSubagents", () => {
  it("exposes one delegate_research and gives research only read_file", async () => {
    const tools = new Registry();
    tools.register(readFileTool);
    tools.register(writeFileTool);
    const subagents = new SubagentRegistry();
    const provider = new MockProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "done" }], usage: emptyUsage() },
    ]);

    registerSubagents(provider, tools, captureSink().sink, subagents);
    registerSubagents(provider, tools, captureSink().sink, subagents);

    assert.deepEqual(
      tools.definitions().map((def) => def.name),
      ["delegate_research", "read_file", "write_file"],
    );
    assert.deepEqual(
      subagents.all().map((subagent) => subagent.name()),
      ["research"],
    );

    const answer = await subagents.all()[0]?.run("task");
    assert.equal(answer, "done");
    assert.deepEqual(
      provider.toolsAt(0)?.map((tool) => tool.name),
      ["read_file"],
    );
  });
});
