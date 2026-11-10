import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Message } from "../../src/api/types.ts";
import { SlidingWindow } from "../../src/compact/sliding.ts";

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function pair(): Message[] {
  return [
    user("a"),
    { role: "assistant", content: [{ type: "tool_use", toolUseId: "t", toolName: "cmd", toolInput: "{}" }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "t", toolResult: "ok" }] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
    user("next"),
  ];
}

describe("SlidingWindow", () => {
  it("keeps the history when it is already short enough", async () => {
    const messages = [user("a"), { role: "assistant", content: [{ type: "text", text: "b" }] }];
    const out = await new SlidingWindow(6).compact(messages);
    assert.equal(out, messages);
  });

  it("drops the prefix on a plain user message", async () => {
    const messages = pair();
    const out = await new SlidingWindow(1).compact(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.content[0]?.text, "next");
  });

  it("keeps a tool call with its result when the cut would land between them", async () => {
    const messages = pair();
    const out = await new SlidingWindow(2).compact(messages);
    assert.equal(out.length, messages.length);
  });
});
