import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { activeMention, expandMentions, filterMentions, insertMention, listProjectEntries } from "./mention.ts";

describe("activeMention", () => {
  it("reads the @ token under the cursor", () => {
    assert.deepEqual(activeMention("lee @src/index.ts ahora", 17), { start: 4, query: "src/index.ts" });
    assert.equal(activeMention("correo foo@bar.com", 14), null);
    assert.equal(activeMention("listo @src/index.ts ", 19), null);
  });
});

describe("filterMentions", () => {
  const items = [
    { path: "src", kind: "dir" as const },
    { path: "package.json", kind: "file" as const },
    { path: "src/index.ts", kind: "file" as const },
  ];

  it("keeps the given order when the query is empty", () => {
    assert.deepEqual(filterMentions(items, "").map((item) => item.path), ["src", "package.json", "src/index.ts"]);
  });

  it("prefers a basename that starts with the query", () => {
    assert.equal(filterMentions(items, "ind")[0]?.path, "src/index.ts");
  });
});

describe("insertMention", () => {
  it("replaces the query and quotes a path that has a space", () => {
    assert.deepEqual(insertMention("mira @sr", 8, 5, "src/index.ts"), { input: "mira @src/index.ts ", cursor: 18 });
    assert.equal(insertMention("@my", 3, 0, "my docs").input, '@"my docs" ');
  });
});

describe("project mentions", () => {
  it("lists the project and skips dependency and hidden folders", () => {
    const root = mkdtempSync(join(tmpdir(), "harto-mention-"));
    writeFileSync(join(root, "package.json"), "{}\n", "utf8");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "export const n = 1;\n", "utf8");
    mkdirSync(join(root, "node_modules", "left"), { recursive: true });
    writeFileSync(join(root, "node_modules", "left", "index.js"), "nope", "utf8");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "config"), "x", "utf8");

    const paths = listProjectEntries(root).map((item) => item.path);
    assert.deepEqual(paths, ["src", "package.json", "src/index.ts"]);
  });

  it("attaches a file and a folder, and drops a path outside the project", () => {
    const root = mkdtempSync(join(tmpdir(), "harto-mention-"));
    const outside = mkdtempSync(join(tmpdir(), "harto-outside-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "hola\n", "utf8");
    mkdirSync(join(root, "my docs"), { recursive: true });
    writeFileSync(join(root, "my docs", "nota.txt"), "uno", "utf8");
    writeFileSync(join(root, "bin.dat"), Buffer.from([0, 1, 2]));
    writeFileSync(join(outside, "secret.txt"), "no", "utf8");

    const text = expandMentions(`mira @src/index.ts y @"my docs" y @${join(outside, "secret.txt")} y @bin.dat`, root);
    assert.match(text, /<file path="src\/index\.ts">\nhola\n<\/file>/);
    assert.match(text, /<folder path="my docs">\nnota\.txt\n<\/folder>/);
    assert.doesNotMatch(text, /<file path="[^"]*secret\.txt"/);
    assert.match(text, /<file path="bin\.dat">\n\(binary, contents omitted\)\n<\/file>/);
  });
});
