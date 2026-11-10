import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Message } from "../../src/api/types.ts";
import { NoCompaction, safeSplitPoint } from "../../src/compact/strategy.ts";

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

describe("safeSplitPoint", () => {
  const messages: Message[] = [
    user("a"),
    { role: "assistant", content: [{ type: "tool_use", toolUseId: "t", toolName: "cmd", toolInput: "{}" }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "t", toolResult: "ok" }] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
    user("next"),
  ];

  it("keeps a plain user message as a boundary", () => {
    assert.equal(safeSplitPoint(messages, 4), 4);
  });

  it("walks back rather than splitting a tool result from its call", () => {
    assert.equal(safeSplitPoint(messages, 2), 0);
  });

  it("returns 0 when there is no safe boundary", () => {
    assert.equal(safeSplitPoint(messages, 0), 0);
    assert.equal(safeSplitPoint(messages, messages.length), messages.length);
  });
});

describe("NoCompaction", () => {
  it("returns the same array", async () => {
    const messages = [user("a")];
    assert.equal(await new NoCompaction().compact(messages), messages);
  });
});
