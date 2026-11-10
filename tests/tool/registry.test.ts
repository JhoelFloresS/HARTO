import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Registry, type Tool } from "../../src/tool/registry.ts";

function fakeTool(name: string, result = "", isError = false): Tool {
  return {
    definition: () => ({
      name,
      description: `${name} description`,
      inputSchema: {},
      required: [],
    }),
    async execute() {
      return { result, isError };
    },
  };
}

describe("Registry", () => {
  it("registers and gets by name", () => {
    const registry = new Registry();
    registry.register(fakeTool("alpha"));
    assert.equal(registry.get("alpha")?.definition().name, "alpha");
    assert.equal(registry.get("missing"), undefined);
  });

  it("sorts definitions by name", () => {
    const registry = new Registry();
    registry.register(fakeTool("zebra"));
    registry.register(fakeTool("alpha"));
    registry.register(fakeTool("middle"));
    assert.deepEqual(
      registry.definitions().map((def) => def.name),
      ["alpha", "middle", "zebra"],
    );
  });

  it("subsets only the named tools", () => {
    const registry = new Registry();
    registry.register(fakeTool("a"));
    registry.register(fakeTool("b"));
    registry.register(fakeTool("c"));
    const sub = registry.subset("a", "c", "missing");
    assert.ok(sub.get("a"));
    assert.ok(sub.get("c"));
    assert.equal(sub.get("b"), undefined);
    assert.equal(sub.get("missing"), undefined);
  });

  it("returns an empty registry from subset()", () => {
    const registry = new Registry();
    registry.register(fakeTool("a"));
    assert.deepEqual(registry.subset().definitions(), []);
  });

  it("reports an unknown tool as an error result", async () => {
    const registry = new Registry();
    const got = await registry.execute("nope", "{}");
    assert.equal(got.isError, true);
    assert.match(got.result, /unknown tool/);
  });

  it("dispatches to the registered tool", async () => {
    const registry = new Registry();
    registry.register(fakeTool("echo", "ok", false));
    const got = await registry.execute("echo", "{}");
    assert.deepEqual(got, { result: "ok", isError: false });
  });

  it("propagates isError", async () => {
    const registry = new Registry();
    registry.register(fakeTool("boom", "kaboom", true));
    const got = await registry.execute("boom", "{}");
    assert.deepEqual(got, { result: "kaboom", isError: true });
  });
});
