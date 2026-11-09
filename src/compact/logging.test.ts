import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { Message } from "../api/types.ts";
import { captureSink } from "../output.ts";
import { LoggingStrategy, withLogging } from "./logging.ts";
import { NoCompaction } from "./strategy.ts";
import { SlidingWindow } from "./sliding.ts";

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text: string): Message {
  return { role: "assistant", content: [{ type: "text", text }] };
}

describe("LoggingStrategy", () => {
  it("appends a before/after transcript only when the length changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harto-compact-"));
    const file = join(dir, "compact.log");
    const messages = [user("one"), assistant("two"), user("three"), assistant("four")];
    const changed = await withLogging(new SlidingWindow(2), file).compact(messages);
    assert.equal(changed.length, 2);
    const body = readFileSync(file, "utf8");
    assert.match(body, /BEFORE \(4 messages\)/);
    assert.match(body, /AFTER \(2 messages\)/);
    assert.match(body, /one/);

    const untouched = join(dir, "untouched.log");
    await withLogging(new NoCompaction(), untouched).compact(messages);
    assert.equal(existsSync(untouched), false);
  });

  it("reports a write failure and still returns the compacted history", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harto-compact-"));
    const captured = captureSink();
    const messages = [user("one"), assistant("two"), user("three"), assistant("four")];
    const out = await new LoggingStrategy(new SlidingWindow(2), join(dir, "missing", "compact.log"), captured.sink).compact(messages);
    assert.equal(out.length, 2);
    assert.match(captured.text(), /compaction log write failed/);
  });

  it("propagates an inner failure", async () => {
    const boom = {
      async compact(): Promise<Message[]> {
        throw new Error("nope");
      },
    };
    await assert.rejects(withLogging(boom, "unused.log").compact([]), /nope/);
  });
});
