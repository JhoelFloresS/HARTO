import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Message } from "../api/types.ts";
import { captureSink } from "../output.ts";
import { MockProvider } from "../provider/mock.ts";
import { emptyUsage } from "../api/types.ts";
import { Summarize } from "./summarize.ts";

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text: string): Message {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function history(): Message[] {
  return [user("one"), assistant("two"), user("three"), assistant("four"), user("five"), assistant("six")];
}

describe("Summarize", () => {
  it("does not call the provider under the threshold", async () => {
    const mock = new MockProvider();
    const messages = history();
    const out = await new Summarize(mock, 100, 4).compact(messages);
    assert.equal(out, messages);
    assert.equal(mock.calls(), 0);
  });

  it("replaces the old prefix and keeps the recent suffix", async () => {
    const captured = captureSink();
    const mock = new MockProvider([
      {
        stopReason: "end_turn",
        content: [
          { type: "text", text: "secret", providerMeta: { gemini: { thought: true } } },
          { type: "text", text: "kept the path src/cmd.ts" },
        ],
        usage: emptyUsage(),
      },
    ]);
    const messages = history();
    const out = await new Summarize(mock, 0, 4, captured.sink).compact(messages);
    assert.equal(mock.calls(), 1);
    assert.deepEqual(mock.toolsAt(0), []);
    assert.equal(out.length, 5);
    assert.equal(out[0]?.role, "user");
    assert.match(out[0]?.content[0]?.text ?? "", /\[earlier conversation summary\]/);
    assert.match(out[0]?.content[0]?.text ?? "", /src\/cmd\.ts/);
    assert.equal(out[0]?.content[0]?.text?.includes("secret"), false);
    assert.equal(out.at(-1)?.content[0]?.text, "six");
    assert.match(captured.text(), /\[compacted 2 messages → summary\]/);
  });

  it("rejects an empty summary and leaves the caller to keep the original history", async () => {
    const mock = new MockProvider([{ stopReason: "end_turn", content: [], usage: emptyUsage() }]);
    await assert.rejects(new Summarize(mock, 0, 4).compact(history()), /summarize: empty response/);
  });
});
