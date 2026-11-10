import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { loadEnvFile } from "../src/env.ts";

const keys = ["HARTO_ENV_TEST", "HARTO_ENV_TEST_2", "HARTO_ENV_TEST_3", "HARTO_ENV_QUOTED"];

describe("loadEnvFile", () => {
  afterEach(() => {
    for (const key of keys) delete process.env[key];
  });

  it("reads set, export, and bare assignments without overriding the process", () => {
    const dir = mkdtempSync(join(tmpdir(), "harto-env-"));
    writeFileSync(
      join(dir, ".env"),
      ["# comment", "set HARTO_ENV_TEST=from-file", "export HARTO_ENV_TEST_2=two", "HARTO_ENV_TEST_3=three", 'HARTO_ENV_QUOTED="a b"', ""].join("\n"),
      "utf8",
    );
    process.env.HARTO_ENV_TEST = "already";
    loadEnvFile(join(dir, ".env"));
    assert.equal(process.env.HARTO_ENV_TEST, "already");
    assert.equal(process.env.HARTO_ENV_TEST_2, "two");
    assert.equal(process.env.HARTO_ENV_TEST_3, "three");
    assert.equal(process.env.HARTO_ENV_QUOTED, "a b");
  });

  it("ignores a missing file", () => {
    loadEnvFile(join(tmpdir(), "harto-env-missing", ".env"));
  });
});
