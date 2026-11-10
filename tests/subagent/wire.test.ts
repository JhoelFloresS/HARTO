import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyUsage } from "../../src/api/types.ts";
import { captureSink } from "../../src/output.ts";
import { MockProvider } from "../../src/provider/mock.ts";
import { Registry } from "../../src/tool/registry.ts";
import { readFileTool } from "../../src/tool/read-file.ts";
import { searchTool } from "../../src/tool/search.ts";
import { writeFileTool } from "../../src/tool/write-file.ts";
import { SubagentRegistry } from "../../src/subagent/registry.ts";
import { registerSubagents } from "../../src/subagent/wire.ts";

describe("registerSubagents", () => {
  it("exposes one delegate_research and gives research read_file and search", async () => {
    const tools = new Registry();
    tools.register(readFileTool);
    tools.register(searchTool);
    tools.register(writeFileTool);
    const subagents = new SubagentRegistry();
    const provider = new MockProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "done" }], usage: emptyUsage() },
    ]);

    registerSubagents(provider, tools, captureSink().sink, subagents);
    registerSubagents(provider, tools, captureSink().sink, subagents);

    assert.deepEqual(
      tools.definitions().map((def) => def.name),
      ["delegate_research", "read_file", "search", "write_file"],
    );
    assert.deepEqual(
      subagents.all().map((subagent) => subagent.name()),
      ["research"],
    );

    const answer = await subagents.all()[0]?.run("task");
    assert.equal(answer, "done");
    assert.deepEqual(
      provider.toolsAt(0)?.map((tool) => tool.name),
      ["read_file", "search"],
    );
  });
});
