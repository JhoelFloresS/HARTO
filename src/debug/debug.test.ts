import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  clearDebug,
  debugEnabled,
  findById,
  pair,
  record,
  recordp,
  recordpc,
  setDebugEnabled,
  snapshot,
} from "./debug.ts";

afterEach(() => {
  setDebugEnabled(false);
  clearDebug();
});

describe("debug ring", () => {
  it("does not store events while disabled", () => {
    assert.equal(debugEnabled(), false);
    assert.equal(record("tool", "info", "hidden"), 0);
    assert.deepEqual(snapshot(), []);
  });

  it("correlates a response back to its request", () => {
    setDebugEnabled(true);
    const requestId = recordp("provider", "info", "request", "{\"ok\":true}");
    const responseId = recordpc(requestId, "provider", "info", "response", "body");
    assert.equal(pair(responseId)?.id, requestId);
    assert.equal(pair(requestId)?.id, responseId);
    assert.equal(findById(requestId)?.payload, "{\"ok\":true}");
  });

  it("drops the oldest event past 500", () => {
    setDebugEnabled(true);
    for (let i = 0; i < 501; i++) record("tool", "info", `n${i}`);
    const events = snapshot();
    assert.equal(events.length, 500);
    assert.equal(events[0]?.message, "n1");
    assert.equal(events.at(-1)?.message, "n500");
  });

  it("caps a payload at 100 KiB", () => {
    setDebugEnabled(true);
    const id = recordp("tool", "info", "big", "x".repeat(100 * 1024 + 50));
    const payload = findById(id)?.payload ?? "";
    assert.ok(payload.endsWith("\n…[truncated]"));
    assert.ok(Buffer.byteLength(payload, "utf8") < 100 * 1024 + 50);
  });
});
