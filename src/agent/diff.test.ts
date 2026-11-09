import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { buildWriteDiff } from "./diff.ts";

describe("buildWriteDiff", () => {
  it("shows additions for a new file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harto-diff-"));
    const target = path.join(dir, "fresh.txt");
    const diff = buildWriteDiff(JSON.stringify({ path: target, content: "line one\nline two\n" }));
    assert.notEqual(diff, "");
    assert.ok(diff.includes("/dev/null"), diff);
    assert.ok(diff.includes("+line one"), diff);
    assert.ok(diff.includes("+line two"), diff);
  });

  it("shows changed lines with context", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harto-diff-"));
    const target = path.join(dir, "file.txt");
    await writeFile(target, "a\nb\nc\n");
    const diff = buildWriteDiff(JSON.stringify({ path: target, content: "a\nB\nc\n" }));
    assert.ok(diff.includes("-b"), diff);
    assert.ok(diff.includes("+B"), diff);
    assert.ok(diff.includes(" a"), diff);
  });

  it("returns a marker when the content is identical", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harto-diff-"));
    const target = path.join(dir, "same.txt");
    await writeFile(target, "hello\n");
    const diff = buildWriteDiff(JSON.stringify({ path: target, content: "hello\n" }));
    assert.ok(diff.includes("no changes"), diff);
  });

  it("returns empty for malformed input", () => {
    assert.equal(buildWriteDiff("not json"), "");
  });
});
