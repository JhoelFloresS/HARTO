import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DelegateTool } from "./delegate.ts";
import { captureSink } from "./output.ts";
import type { Subagent } from "./subagent/registry.ts";

function fake(run: Subagent["run"], name = "research"): Subagent {
  return {
    name: () => name,
    description: () => "look things up",
    run,
  };
}

describe("delegate tool", () => {
  it("names itself after the subagent and requires a task", () => {
    const tool = new DelegateTool(fake(async () => "ok"));
    const def = tool.definition();
    assert.equal(def.name, "delegate_research");
    assert.equal(def.description, "look things up");
    assert.deepEqual(def.required, ["task"]);
  });

  it("rejects input that is not JSON", async () => {
    let called = false;
    const tool = new DelegateTool(
      fake(async () => {
        called = true;
        return "nope";
      }),
    );
    const got = await tool.execute("{", {});
    assert.equal(got.isError, true);
    assert.match(got.result, /invalid tool input/);
    assert.equal(called, false);
  });

  it("rejects a payload without a task string", async () => {
    const tool = new DelegateTool(fake(async () => "nope"));
    const got = await tool.execute("{}", {});
    assert.equal(got.isError, true);
    assert.match(got.result, /task/);
  });

  it("prints the delegation lines and returns the answer", async () => {
    const captured = captureSink();
    const tool = new DelegateTool(
      fake(async (task) => `found ${task}`),
      captured.sink,
    );
    const got = await tool.execute(JSON.stringify({ task: "where is Agent" }), {});
    assert.equal(got.isError, false);
    assert.equal(got.result, "found where is Agent");
    assert.match(captured.text(), /↳ delegating to research subagent/);
    assert.match(captured.text(), /← research subagent done \(\d+ms\)/);
  });

  it("turns a rejected run into a tool error after the done line", async () => {
    const captured = captureSink();
    const tool = new DelegateTool(
      fake(async () => {
        throw new Error("down");
      }),
      captured.sink,
    );
    const got = await tool.execute(JSON.stringify({ task: "look" }), {});
    assert.equal(got.isError, true);
    assert.equal(got.result, "subagent error: down");
    assert.match(captured.text(), /← research subagent done/);
  });
});
