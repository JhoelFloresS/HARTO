import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { editTool } from "../../src/tool/edit.ts";
import { searchTool } from "../../src/tool/search.ts";

describe("search", () => {
  it("finds a line and does not leave the project", async () => {
    const previous = process.cwd();
    const root = mkdtempSync(join(tmpdir(), "harto-search-"));
    const outside = mkdtempSync(join(tmpdir(), "harto-search-out-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "app.ts"), "export const token = 1;\n", "utf8");
      mkdirSync(join(root, "node_modules"));
      writeFileSync(join(root, "node_modules", "skip.js"), "token\n", "utf8");
      writeFileSync(join(outside, "secret.ts"), "token\n", "utf8");
      process.chdir(root);

      const found = await searchTool.execute(JSON.stringify({ query: "token", glob: "*.ts" }));
      assert.equal(found.isError, false);
      assert.match(found.result, /src\/app\.ts:1: export const token = 1;/);
      assert.doesNotMatch(found.result, /node_modules/);

      const escaped = await searchTool.execute(JSON.stringify({ query: "token", path: outside }));
      assert.equal(escaped.isError, true);
      assert.match(escaped.result, /outside the working directory/);
    } finally {
      process.chdir(previous);
    }
  });
});

describe("edit", () => {
  it("replaces one unique snippet and rejects an ambiguous one", async () => {
    const root = mkdtempSync(join(tmpdir(), "harto-edit-"));
    const file = join(root, "app.txt");
    writeFileSync(file, "alpha\nbeta\nalpha\n", "utf8");

    const ambiguous = await editTool.execute(JSON.stringify({ path: file, old: "alpha", new: "gamma" }));
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.result, /appears 2 times/);

    const edited = await editTool.execute(JSON.stringify({ path: file, old: "beta", new: "BETA" }));
    assert.equal(edited.isError, false);
    assert.match(edited.result, /edited/);
  });
});
