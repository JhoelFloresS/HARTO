import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { SessionFiles } from "../memory/session-files.ts";
import { NoMemory, setMemoryStore } from "../memory/store.ts";
import { recallTool } from "./recall.ts";
import { rememberTool } from "./remember.ts";

describe("remember and recall", () => {
  afterEach(() => {
    setMemoryStore(new NoMemory());
  });

  it("reports success on NoMemory and finds nothing", async () => {
    const saved = await rememberTool.execute(JSON.stringify({ content: "tabs" }), {});
    assert.deepEqual(saved, { result: "remembered.", isError: false });
    const found = await recallTool.execute(JSON.stringify({ query: "tabs" }), {});
    assert.deepEqual(found, { result: "no matches.", isError: false });
  });

  it("rejects a remember call without content", async () => {
    const saved = await rememberTool.execute(JSON.stringify({ kind: "fact" }), {});
    assert.equal(saved.isError, true);
    assert.match(saved.result, /content/);
  });

  it("does not find a fact until the session is closed and reopened", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harto-tools-"));
    const store = SessionFiles.open(dir, new Date(2026, 10, 5, 10, 9));
    setMemoryStore(store);
    await rememberTool.execute(JSON.stringify({ content: "prefer tabs", kind: "preference", tags: ["style"] }), {});
    const during = await recallTool.execute(JSON.stringify({ query: "tabs" }), {});
    assert.equal(during.result, "no matches.");
    await store.save({ time: new Date(), kind: "session-summary", content: "chose tabs", tags: ["style"] });
    await store.close();

    setMemoryStore(SessionFiles.open(dir));
    const after = await recallTool.execute(JSON.stringify({ query: "tabs" }), {});
    assert.equal(after.isError, false);
    assert.match(after.result, /chose tabs/);
    assert.match(after.result, /style/);
  });
});
