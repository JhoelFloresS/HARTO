import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyUsage, type Message } from "../api/types.ts";
import { MockProvider } from "../provider/mock.ts";
import { parseSummaryAndTags, summarizeSession } from "./summarize.ts";

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

describe("parseSummaryAndTags", () => {
  it("splits on the last TAGS line", () => {
    const parsed = parseSummaryAndTags("ignore\n\nTAGS: no\n\nFixed the shell.\n\nTAGS: Cmd, windows");
    assert.equal(parsed.summary, "ignore\n\nTAGS: no\n\nFixed the shell.");
    assert.deepEqual(parsed.tags, ["cmd", "windows"]);
  });

  it("keeps the whole reply when there is no TAGS line", () => {
    const parsed = parseSummaryAndTags("  just the paragraph  ");
    assert.equal(parsed.summary, "just the paragraph");
    assert.deepEqual(parsed.tags, []);
  });
});

describe("summarizeSession", () => {
  it("asks the provider with no tools and skips a thought", async () => {
    const mock = new MockProvider([
      {
        stopReason: "end_turn",
        content: [
          { type: "text", text: "secret", providerMeta: { gemini: { thought: true } } },
          { type: "text", text: "Wired cmd.\n\nTAGS: cmd" },
        ],
        usage: emptyUsage(),
      },
    ]);
    const parsed = await summarizeSession(mock, [user("hello")]);
    assert.equal(parsed.summary, "Wired cmd.");
    assert.deepEqual(parsed.tags, ["cmd"]);
    assert.deepEqual(mock.toolsAt(0), []);
  });

  it("returns a failure note when the provider rejects", async () => {
    const mock = new MockProvider();
    mock.err = new Error("down");
    const parsed = await summarizeSession(mock, [user("hello")]);
    assert.equal(parsed.summary, "(summarization failed: down)");
    assert.deepEqual(parsed.tags, []);
  });

  it("truncates a long transcript", async () => {
    const mock = new MockProvider([{ stopReason: "end_turn", content: [{ type: "text", text: "ok" }], usage: emptyUsage() }]);
    await summarizeSession(mock, [user("x".repeat(60_000))]);
    const sent = mock.lastSent()?.[0]?.content[0]?.text ?? "";
    assert.match(sent, /\n\[\.\.\.truncated\.\.\.\]/);
    assert.ok(sent.length < 60_000);
  });
});
