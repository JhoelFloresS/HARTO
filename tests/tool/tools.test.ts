import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { cmdTool } from "../../src/tool/cmd.ts";
import { readFileTool } from "../../src/tool/read-file.ts";
import { defaultRegistry } from "../../src/tool/register.ts";
import { writeFileTool } from "../../src/tool/write-file.ts";

describe("default registry", () => {
  it("exposes cmd, read_file, write_file, remember, and recall", () => {
    assert.deepEqual(
      defaultRegistry.definitions().map((def) => def.name),
      ["cmd", "edit", "read_file", "recall", "remember", "search", "write_file"],
    );
  });
});

describe("cmd", () => {
  it("runs a command through cmd.exe", async () => {
    const got = await cmdTool.execute(JSON.stringify({ command: "echo harto-cmd-ok" }), {});
    assert.equal(got.isError, false);
    assert.match(got.result, /harto-cmd-ok/);
  });

  it("reports a non-zero exit as a tool error", async () => {
    const got = await cmdTool.execute(JSON.stringify({ command: "exit 3" }), {});
    assert.equal(got.isError, true);
    assert.match(got.result, /exit status 3/);
  });

  it("rejects input without a command", async () => {
    const got = await cmdTool.execute("{}", {});
    assert.equal(got.isError, true);
    assert.match(got.result, /command/);
  });

  it("rejects invalid json", async () => {
    const got = await cmdTool.execute("not json", {});
    assert.equal(got.isError, true);
    assert.match(got.result, /invalid tool input/);
  });

  it("cancels when the signal aborts", { timeout: 8_000 }, async () => {
    const controller = new AbortController();
    const pending = cmdTool.execute(JSON.stringify({ command: "ping -n 30 127.0.0.1" }), {
      signal: controller.signal,
    });
    controller.abort();
    const got = await pending;
    assert.equal(got.isError, true);
    assert.match(got.result, /command cancelled/);
  });
});

describe("read_file and write_file", () => {
  it("round-trips a file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harto-fs-"));
    const target = path.join(dir, "note.txt");
    const written = await writeFileTool.execute(
      JSON.stringify({ path: target, content: "hola" }),
      {},
    );
    assert.equal(written.isError, false);
    assert.match(written.result, /wrote 4 bytes/);
    const read = await readFileTool.execute(JSON.stringify({ path: target }), {});
    assert.deepEqual(read, { result: "hola", isError: false });
    assert.equal(await readFile(target, "utf8"), "hola");
  });

  it("returns an error result for a missing file", async () => {
    const got = await readFileTool.execute(
      JSON.stringify({ path: path.join(tmpdir(), "harto-missing-file.txt") }),
      {},
    );
    assert.equal(got.isError, true);
  });

  it("truncates reads past 100 KiB", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harto-fs-"));
    const target = path.join(dir, "big.txt");
    await writeFile(target, "a".repeat(100 * 1024 + 20));
    const got = await readFileTool.execute(JSON.stringify({ path: target }), {});
    assert.equal(got.isError, false);
    assert.match(got.result, /\n\[truncated]$/);
    assert.ok(Buffer.byteLength(got.result, "utf8") < 100 * 1024 + 20);
  });
});
