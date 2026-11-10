import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { Agent } from "../src/agent/agent.ts";
import { runCommand, type CommandContext } from "../src/commands.ts";
import { clearDebug, recordp, setDebugEnabled } from "../src/debug/debug.ts";
import { captureSink } from "../src/output.ts";
import { emptyUsage } from "../src/api/types.ts";
import { MockProvider } from "../src/provider/mock.ts";
import { subagentRegistry } from "../src/subagent/registry.ts";
import { beginSubagent, clearActiveSubagents } from "../src/subagent/tracker.ts";
import { Registry } from "../src/tool/registry.ts";
import type { Message } from "../src/api/types.ts";

function context(provider: MockProvider = new MockProvider()): { ctx: CommandContext; text: () => string; provider: MockProvider } {
  const captured = captureSink();
  const agent = new Agent(provider, "sys", new Registry(), captured.sink);
  const ctx: CommandContext = {
    agent,
    providerName: "mock",
    write: captured.sink,
    requestExit() {
      exited = true;
    },
  };
  return { ctx, text: captured.text, provider };
}

let exited = false;

function turns(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `m${i}` }],
    });
  }
  return messages;
}

describe("slash commands", () => {
  beforeEach(() => {
    exited = false;
    clearDebug();
    setDebugEnabled(false);
    subagentRegistry.clear();
    clearActiveSubagents();
  });

  it("mentions the current model", async () => {
    const { ctx, text } = context();
    ctx.providerName = "anthropic";
    ctx.agent.provider.setModel("claude-opus-4-7");
    assert.equal(await runCommand("/model", ctx), true);
    assert.match(text(), /claude-opus-4-7/);
    assert.match(text(), /anthropic/);
    assert.match(text(), /validated on next call/);
  });

  it("does not replace the provider when the name is unknown", async () => {
    const { ctx, text, provider } = context();
    assert.equal(await runCommand("/provider nope", ctx), true);
    assert.equal(ctx.agent.provider, provider);
    assert.equal(ctx.providerName, "mock");
    assert.match(text(), /unknown provider/);
  });

  it("switches provider without clearing history", async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    try {
      const { ctx } = context();
      ctx.agent.setMessages(turns(2));
      await runCommand("/provider gemini gemini-3.6-flash", ctx);
      assert.equal(ctx.providerName, "gemini");
      assert.equal(ctx.agent.provider.model(), "gemini-3.6-flash");
      assert.equal(ctx.agent.getMessages().length, 2);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });

  it("clears the root history", async () => {
    const { ctx, text } = context();
    ctx.agent.setMessages(turns(2));
    await runCommand("/clear", ctx);
    assert.equal(ctx.agent.getMessages().length, 0);
    assert.match(text(), /conversation cleared/);
  });

  it("does not throw when the provider reports no usage", async () => {
    const { ctx, text } = context();
    await runCommand("/tokens", ctx);
    assert.match(text(), /doesn't report token usage/);
  });

  it("formats usage and an unknown rate", async () => {
    const provider = new MockProvider();
    const reporter = Object.assign(provider, {
      totalUsage: () => ({ inputTokens: 1500, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 8 }),
      estimatedCostUsd: () => -1,
    });
    const { ctx, text } = context(reporter);
    await runCommand("/tokens", ctx);
    assert.match(text(), /1,500/);
    assert.match(text(), /cache read/);
    assert.match(text(), /unknown model — no rate/);
  });

  it("says the debug log is empty", async () => {
    const { ctx, text } = context();
    await runCommand("/debug ls", ctx);
    assert.match(text(), /debug log is empty/);
  });

  it("lists and shows a recorded event", async () => {
    setDebugEnabled(true);
    const id = recordp("provider", "info", "→ gemini.Send", "{\"model\":\"flash\"}");
    const { ctx, text } = context();
    await runCommand("/debug ls", ctx);
    assert.match(text(), new RegExp(`#${id}`));
    assert.match(text(), /•/);
    await runCommand(`/debug show ${id}`, ctx);
    assert.match(text(), /flash/);
  });

  it("slides the history and rejects an unknown strategy", async () => {
    const { ctx, text } = context();
    ctx.agent.setMessages(turns(8));
    await runCommand("/compact sliding", ctx);
    assert.equal(ctx.agent.getMessages().length, 6);
    assert.match(text(), /compacted: 8 → 6 messages/);
    const kept = ctx.agent.getMessages().length;
    await runCommand("/compact sideways", ctx);
    assert.equal(ctx.agent.getMessages().length, kept);
    assert.match(text(), /unknown strategy/);
  });

  it("lists a running subagent with a count", async () => {
    subagentRegistry.register({
      name: () => "research",
      description: () => "look things up",
      async run() {
        return "";
      },
    });
    beginSubagent("research");
    beginSubagent("research");
    const { ctx, text } = context();
    await runCommand("/subagents", ctx);
    assert.match(text(), /research/);
    assert.match(text(), /×2/);
  });

  it("leaves a normal line for the agent", async () => {
    const provider = new MockProvider([{ stopReason: "end_turn", content: [{ type: "text", text: "hello" }], usage: emptyUsage() }]);
    const { ctx, text } = context(provider);
    assert.equal(await runCommand("hello", ctx), false);
    assert.equal(await ctx.agent.send("hello"), "hello");
    assert.match(text(), /hello/);
  });

  it("exits through the host hook", async () => {
    const { ctx } = context();
    await runCommand("/exit", ctx);
    assert.equal(exited, true);
  });

  it("asks for a project path and relocates", async () => {
    const { ctx, text } = context();
    const answers = ["D:\\demo"];
    let opened = "";
    ctx.ask = () => Promise.resolve(answers.shift() ?? "");
    ctx.relocate = (path) => {
      opened = path;
      return Promise.resolve("demo · Node");
    };
    await runCommand("/open-project", ctx);
    assert.equal(opened, "D:\\demo");
    assert.match(text(), /demo · Node/);
  });

  it("lists MCP servers and appends one", async () => {
    const { ctx, text } = context();
    ctx.listMcp = () => Promise.resolve("git  stdio  conectado  uvx");
    await runCommand("/mcp", ctx);
    assert.match(text(), /git {2}stdio {2}conectado/);
    const added: string[] = [];
    const answers = ["notes", "stdio", "npx", ""];
    let step = 0;
    ctx.ask = () => Promise.resolve(answers[step++] ?? "");
    ctx.addMcp = (server) => {
      added.push(server.name, server.transport, server.command ?? "");
      return Promise.resolve();
    };
    await runCommand("/mcp add", ctx);
    assert.deepEqual(added, ["notes", "stdio", "npx"]);
  });
});
