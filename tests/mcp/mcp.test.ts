import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { expandServer, loadConfig } from "../../src/mcp/config.ts";
import { connectServer } from "../../src/mcp/client.ts";
import { noteMcpProgress } from "../../src/mcp/progress.ts";
import { flattenContent, MCPTool, registerMcp } from "../../src/mcp/register.ts";
import { guardClose, type McpSession, type RemoteTool } from "../../src/mcp/session.ts";
import { Registry } from "../../src/tool/registry.ts";

class FakeSession implements McpSession {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  closes = 0;
  boom: string | null = null;
  private tools: RemoteTool[];
  private result: { content: Array<{ type?: string; text?: string }>; isError: boolean };
  private failList: boolean;

  constructor(
    tools: RemoteTool[],
    result: { content: Array<{ type?: string; text?: string }>; isError: boolean } = {
      content: [{ type: "text", text: "ok" }],
      isError: false,
    },
    failList = false,
  ) {
    this.tools = tools;
    this.result = result;
    this.failList = failList;
  }

  async listTools(): Promise<RemoteTool[]> {
    if (this.failList) throw new Error("list down");
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type?: string; text?: string }>; isError: boolean }> {
    if (this.boom) throw new Error(this.boom);
    this.calls.push({ name, args });
    return this.result;
  }

  async close(): Promise<void> {
    this.closes += 1;
  }
}

describe("loadConfig", () => {
  it("returns null when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harto-mcp-"));
    assert.equal(await loadConfig(join(dir, "mcp.json")), null);
  });

  it("rejects invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harto-mcp-"));
    const path = join(dir, "mcp.json");
    await writeFile(path, "{", "utf8");
    await assert.rejects(loadConfig(path), /parse mcp config/);
  });
});

describe("expandServer", () => {
  const previous = process.env.HARTO_MCP_TEST;

  afterEach(() => {
    if (previous === undefined) delete process.env.HARTO_MCP_TEST;
    else process.env.HARTO_MCP_TEST = previous;
  });

  it("expands values and leaves header names alone", () => {
    process.env.HARTO_MCP_TEST = "sekret";
    const expanded = expandServer({
      name: "github",
      transport: "http",
      command: "${HARTO_MCP_TEST}",
      url: "https://example.test/${HARTO_MCP_TEST}",
      headers: { "X-${HARTO_MCP_TEST}": "Bearer ${HARTO_MCP_TEST}" },
    });
    assert.equal(expanded.command, "sekret");
    assert.equal(expanded.url, "https://example.test/sekret");
    assert.deepEqual(expanded.headers, { "X-${HARTO_MCP_TEST}": "Bearer sekret" });
  });

  it("turns an unset variable into an empty string", () => {
    delete process.env.HARTO_MCP_MISSING;
    assert.equal(expandServer({ name: "g", transport: "http", url: "https://example.test/${HARTO_MCP_MISSING}" }).url, "https://example.test/");
  });
});

describe("registerMcp", () => {
  it("does nothing when there is no config", async () => {
    const events: string[] = [];
    const opened = await registerMcp(null, new Registry(), {
      progress(event) {
        events.push(event.phase);
      },
    });
    assert.deepEqual(opened, []);
    assert.deepEqual(events, []);
  });

  it("registers the healthy server when another fails", async () => {
    const git = new FakeSession([
      {
        name: "status",
        description: "git status",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      { name: "weird", description: "nope", inputSchema: "not-an-object" },
    ]);
    const warnings: string[] = [];
    const phases: string[] = [];
    const registry = new Registry();
    const seen: string[] = [];

    const opened = await registerMcp(
      {
        servers: [
          { name: "down", transport: "stdio", command: "missing" },
          { name: "git", transport: "stdio", command: "git" },
        ],
      },
      registry,
      {
        stderr(line) {
          warnings.push(line);
        },
        progress(event) {
          phases.push(event.phase);
        },
        async dial(server) {
          seen.push(server.name);
          if (server.name === "down") throw new Error("boom");
          return git;
        },
      },
    );

    assert.deepEqual(seen, ["down", "git"]);
    assert.deepEqual(opened, [git]);
    assert.deepEqual(
      registry.definitions().map((def) => def.name),
      ["git_status"],
    );
    const tool = registry.get("git_status");
    assert.equal(tool && "mcp" in tool && tool.mcp, true);
    assert.deepEqual(tool?.definition().inputSchema, { path: { type: "string" } });
    assert.deepEqual(tool?.definition().required, ["path"]);
    assert.match(warnings.join(""), /skip server "down": boom/);
    assert.match(warnings.join(""), /skip git\/weird: unrecognized input schema/);
    assert.deepEqual(phases, ["begin", "connecting", "failed", "connecting", "connected", "done"]);

    const got = await tool!.execute(JSON.stringify({ path: "." }), {});
    assert.equal(got.isError, false);
    assert.equal(got.result, "ok");
    assert.deepEqual(git.calls, [{ name: "status", args: { path: "." } }]);
  });

  it("closes a server whose tool list fails and still finishes", async () => {
    const broken = new FakeSession([], { content: [], isError: false }, true);
    const warnings: string[] = [];
    const opened = await registerMcp({ servers: [{ name: "files", transport: "stdio", command: "x" }] }, new Registry(), {
      stderr(line) {
        warnings.push(line);
      },
      async dial() {
        return broken;
      },
    });
    assert.deepEqual(opened, []);
    assert.equal(broken.closes, 1);
    assert.match(warnings.join(""), /list tools from "files" failed: list down/);
  });

  it("registers a tool whose schema omits properties", async () => {
    const session = new FakeSession([{ name: "ping", description: "ping", inputSchema: { type: "object" } }]);
    const registry = new Registry();
    await registerMcp({ servers: [{ name: "s", transport: "http", url: "https://example.test" }] }, registry, {
      async dial() {
        return session;
      },
    });
    assert.deepEqual(registry.get("s_ping")?.definition().inputSchema, {});
    assert.deepEqual(registry.get("s_ping")?.definition().required, []);
  });
});

describe("MCPTool", () => {
  it("flattens text and non-text blocks and keeps the server error flag", async () => {
    const session = new FakeSession([], {
      content: [{ type: "text", text: "hello" }, { type: "image" }, { type: "text", text: "there" }],
      isError: true,
    });
    const tool = new MCPTool(session, "status", {
      name: "git_status",
      description: "git status",
      inputSchema: {},
      required: [],
    });
    const got = await tool.execute("{}", {});
    assert.equal(got.isError, true);
    assert.equal(got.result, "hello\n[non-text content block: image]\nthere");
    assert.equal(flattenContent([{ type: "resource" }]), "[non-text content block: resource]");
  });

  it("reports invalid JSON and a transport failure as tool errors", async () => {
    const session = new FakeSession([]);
    session.boom = "socket hang up";
    const tool = new MCPTool(session, "status", {
      name: "git_status",
      description: "",
      inputSchema: {},
      required: [],
    });
    const bad = await tool.execute("{", {});
    assert.equal(bad.isError, true);
    assert.match(bad.result, /invalid tool input/);
    const down = await tool.execute("{}", {});
    assert.equal(down.isError, true);
    assert.equal(down.result, "socket hang up");
  });
});

describe("progress lines", () => {
  it("names the server in flight and the final tally", () => {
    const state = { finished: 0, failed: 0 };
    assert.equal(noteMcpProgress({ phase: "begin", total: 2 }, state), null);
    assert.equal(noteMcpProgress({ phase: "connecting", server: "git", total: 2 }, state), "connecting MCP: git (1/2)");
    assert.equal(noteMcpProgress({ phase: "failed", server: "git", total: 2 }, state), null);
    assert.equal(noteMcpProgress({ phase: "connecting", server: "fs", total: 2 }, state), "connecting MCP: fs (2/2)");
    noteMcpProgress({ phase: "connected", server: "fs", total: 2 }, state);
    assert.equal(noteMcpProgress({ phase: "done", total: 2 }, state), "MCP ready (1 server) · 1 failed");
  });
});

describe("session close", () => {
  it("closes only once", async () => {
    let closes = 0;
    const session = guardClose({
      async listTools() {
        return [];
      },
      async callTool() {
        return { content: [], isError: false };
      },
      async close() {
        closes += 1;
      },
    });
    await session.close();
    await session.close();
    assert.equal(closes, 1);
  });
});

describe("connectServer", () => {
  it("rejects a bad entry before loading the SDK", async () => {
    await assert.rejects(connectServer({ name: "git", transport: "stdio" }), /missing command/);
    await assert.rejects(connectServer({ name: "gh", transport: "http" }), /missing url/);
    await assert.rejects(connectServer({ name: "x", transport: "socket" }), /unknown transport "socket"/);
  });
});
