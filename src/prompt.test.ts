import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { baseSystemPrompt, loadAgentsContext } from "./prompt.ts";

describe("baseSystemPrompt", () => {
  it("points read-only questions at delegate_research", () => {
    assert.match(baseSystemPrompt, /delegate_research/);
    assert.match(baseSystemPrompt, /where is X/);
  });
});

describe("loadAgentsContext", () => {
  it("is silent when AGENTS.md is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "harto-prompt-"));
    assert.equal(loadAgentsContext(dir), "");
  });

  it("wraps the file under a fixed header", () => {
    const dir = mkdtempSync(join(tmpdir(), "harto-prompt-"));
    writeFileSync(join(dir, "AGENTS.md"), "use tabs", "utf8");
    const text = loadAgentsContext(dir);
    assert.match(text, /# Project context \(from AGENTS.md\)/);
    assert.match(text, /use tabs/);
  });
});
