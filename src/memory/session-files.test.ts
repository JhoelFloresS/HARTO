import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { SessionFiles } from "./session-files.ts";

function root(): string {
  return mkdtempSync(join(tmpdir(), "harto-memory-"));
}

describe("SessionFiles", () => {
  it("writes markdown and the index, then recall finds the summary", async () => {
    const dir = root();
    const started = new Date(2026, 10, 5, 10, 9);
    const store = SessionFiles.open(dir, started);
    await store.save({ time: started, kind: "fact", content: "use cmd.exe", tags: ["shell"] });
    await store.save({
      time: started,
      kind: "session-summary",
      content: "wired the shell tool",
      tags: ["cmd", "Windows"],
    });
    await store.close();
    await store.close();

    const sessions = readdirSync(join(dir, "sessions"));
    assert.equal(sessions.length, 1);
    const body = readFileSync(join(dir, "sessions", sessions[0]!), "utf8");
    assert.match(body, /## Summary/);
    assert.match(body, /wired the shell tool/);
    assert.match(body, /## Facts/);
    assert.match(body, /use cmd.exe/);
    assert.match(body, /tags: cmd, Windows/);

    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as {
      sessions: Array<{ path: string; summary: string; tags: string[] }>;
    };
    assert.equal(index.sessions.length, 1);
    assert.equal(index.sessions[0]?.summary, "wired the shell tool");
    assert.match(index.sessions[0]?.path ?? "", /^sessions\/2026-11-05-10h09\.md$/);

    const again = SessionFiles.open(dir);
    const hits = await again.recall("shell", 5);
    assert.equal(hits.length, 1);
    assert.match(hits[0]?.content ?? "", /wired the shell tool/);
    assert.equal(hits[0]?.kind, "session-summary");
  });

  it("preamble keeps at most five sessions, newest first", async () => {
    const dir = root();
    for (let i = 0; i < 6; i++) {
      const when = new Date(2026, 0, i + 1, 9, 0);
      const store = SessionFiles.open(dir, when);
      await store.save({ time: when, kind: "session-summary", content: `session ${i}`, tags: [`t${i}`] });
      await store.close();
    }
    const text = await SessionFiles.open(dir).preamble();
    assert.match(text, /session 5/);
    assert.equal(text.includes("session 0"), false);
    const five = text.indexOf("session 5");
    const one = text.indexOf("session 1");
    assert.ok(five >= 0 && one > five);
  });

  it("ignores an index path whose file is gone", async () => {
    const dir = root();
    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "keep.md"), "# keep\n", "utf8");
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify({
        sessions: [
          { path: "sessions/keep.md", date: "2026-11-01T12:00:00.000Z", summary: "keep this", tags: ["present"] },
          { path: "sessions/gone.md", date: "2026-11-02T12:00:00.000Z", summary: "gone missing", tags: ["absent"] },
        ],
      }),
      "utf8",
    );
    const store = SessionFiles.open(dir);
    assert.equal((await store.recall("keep", 5)).length, 1);
    assert.equal((await store.recall("gone", 5)).length, 0);
    assert.equal((await store.recall("absent", 5)).length, 0);
  });

  it("does not create a session file when the draft is empty", async () => {
    const dir = root();
    const store = SessionFiles.open(dir);
    await store.close();
    assert.equal(readdirSync(join(dir, "sessions")).length, 0);
    assert.equal(existsSync(join(dir, "index.json")), false);
  });
});
