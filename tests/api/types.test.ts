import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addUsage,
  emptyUsage,
  hasToolResult,
  renderTranscript,
  type Block,
  type Message,
  type Usage,
} from "../../src/api/types.ts";

describe("addUsage", () => {
  it("sums every field", () => {
    const left: Usage = {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 10,
      cacheReadTokens: 5,
    };
    const right: Usage = {
      inputTokens: 200,
      outputTokens: 30,
      cacheCreationTokens: 0,
      cacheReadTokens: 15,
    };
    assert.deepEqual(addUsage(left, right), {
      inputTokens: 300,
      outputTokens: 80,
      cacheCreationTokens: 10,
      cacheReadTokens: 20,
    });
  });

  it("is commutative", () => {
    const left: Usage = { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 7 };
    const right: Usage = { inputTokens: 200, outputTokens: 30, cacheCreationTokens: 3, cacheReadTokens: 0 };
    assert.deepEqual(addUsage(left, right), addUsage(right, left));
  });

  it("treats zero as a no-op", () => {
    const usage: Usage = { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 };
    assert.deepEqual(addUsage(usage, emptyUsage()), usage);
  });
});

describe("hasToolResult", () => {
  const cases: Array<{ name: string; message: Message; want: boolean }> = [
    { name: "empty content", message: { role: "user", content: [] }, want: false },
    {
      name: "text only",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
      want: false,
    },
    {
      name: "single tool_result",
      message: { role: "user", content: [{ type: "tool_result", toolUseId: "t1" }] },
      want: true,
    },
    {
      name: "mixed text and tool_result",
      message: {
        role: "user",
        content: [
          { type: "text", text: "context" },
          { type: "tool_result", toolUseId: "t" },
        ],
      },
      want: true,
    },
    {
      name: "tool_use is not a tool_result",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", toolUseId: "t1", toolName: "echo" }],
      },
      want: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      assert.equal(hasToolResult(testCase.message), testCase.want);
    });
  }
});

describe("renderTranscript", () => {
  it("includes every block kind and skips providerMeta", () => {
    const thought: Block = {
      type: "text",
      text: "hidden",
      providerMeta: { gemini: { thought: true } },
    };
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      {
        role: "assistant",
        content: [
          thought,
          { type: "tool_use", toolName: "cmd", toolInput: `{"command":"dir"}` },
        ],
      },
      { role: "user", content: [{ type: "tool_result", toolResult: "file.txt" }] },
    ];
    const out = renderTranscript(messages);
    for (const want of ["user:", "assistant:", "hello", "called cmd", `{"command":"dir"}`, "tool result", "file.txt", "hidden"]) {
      assert.ok(out.includes(want), `transcript missing ${want}\n${out}`);
    }
    assert.equal(out.includes("thought"), false);
  });
});
