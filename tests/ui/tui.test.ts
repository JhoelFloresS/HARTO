import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { DebugEvent } from "../../src/debug/debug.ts";
import { loadHistory } from "../../src/ui/history.ts";
import { parseKeys } from "../../src/ui/keys.ts";
import { paint } from "../../src/ui/paint.ts";
import { TuiModel, type UsageSnapshot } from "../../src/ui/tui.ts";

function event(id: number, message: string, payload = ""): DebugEvent {
  return { id, correlatedId: 0, time: new Date(2026, 10, 5, 15, 4, 5), source: "tool", level: "info", message, payload };
}

function usage(partial: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: -1,
    reports: false,
    ...partial,
  };
}

describe("parseKeys", () => {
  it("keeps an unfinished escape for the next chunk", () => {
    const parsed = parseKeys("ab\r\x1b[A\x1b");
    assert.deepEqual(parsed.keys, [
      { kind: "text", text: "ab" },
      { kind: "enter" },
      { kind: "up" },
    ]);
    assert.equal(parsed.rest, "\x1b");
  });
});

describe("TuiModel", () => {
  it("opens with a large violet HARTO and the smaller credit", () => {
    const frame = paint(new TuiModel({ width: 80, height: 24 }));
    assert.match(frame, /██╗  ██╗/);
    assert.match(frame, /by topicos studes/);
  });

  it("shows the project folder and technology", () => {
    const frame = paint(new TuiModel({ width: 80, height: 24, project: "demo · Node" }));
    assert.match(frame, /demo · Node/);
  });

  it("opens an @ picker above the input and inserts the selected path", () => {
    const mentions = () => [
      { path: "src", kind: "dir" as const },
      { path: "package.json", kind: "file" as const },
      { path: "src/index.ts", kind: "file" as const },
    ];
    const model = new TuiModel({ width: 80, height: 24, history: ["older"], mentions });
    model.handle({ kind: "text", text: "@" });
    assert.match(paint(model), /❯ src\//);
    assert.match(paint(model), /package\.json/);
    model.handle({ kind: "down" });
    assert.match(paint(model), /❯ package\.json/);
    model.handle({ kind: "up" });
    assert.equal(model.view().input, "@");
    const action = model.handle({ kind: "enter" });
    assert.equal(action.type, "none");
    assert.equal(model.view().input, "@src ");
    assert.equal(model.view().mention, null);
    assert.equal(model.phase, "idle");
  });

  it("closes the @ picker with esc and does not send when nothing matches", () => {
    const model = new TuiModel({
      width: 80,
      height: 24,
      mentions: () => [{ path: "src/index.ts", kind: "file" }],
    });
    model.handle({ kind: "text", text: "@src" });
    model.handle({ kind: "esc" });
    const closed = model.view();
    assert.equal(closed.mention, null);
    assert.equal(closed.input, "@src");
    model.handle({ kind: "text", text: "x" });
    assert.equal(model.view().mention?.items[0]?.path, "src/index.ts");

    const empty = new TuiModel({
      width: 80,
      height: 24,
      mentions: () => [{ path: "src/index.ts", kind: "file" }],
    });
    empty.handle({ kind: "text", text: "@zzz" });
    assert.match(paint(empty), /no matches/);
    assert.equal(empty.handle({ kind: "enter" }).type, "none");
    assert.equal(empty.phase, "idle");
  });

  it("submits one turn at a time and cancels it", () => {
    const model = new TuiModel({ width: 80, height: 24, subagents: () => [{ name: "research", count: 2 }] });
    model.handle({ kind: "text", text: "  hi  " });
    const first = model.handle({ kind: "enter" });
    assert.equal(first.type, "submit");
    if (first.type !== "submit") return;
    assert.equal(first.line, "hi");
    assert.equal(model.phase, "running");
    assert.match(paint(model), /❯ hi/);
    assert.match(paint(model), /⠋ thinking\.\.\./);
    assert.match(paint(model), /research ×2/);
    assert.equal(model.handle({ kind: "enter" }).type, "none");
    model.tick();
    assert.match(paint(model), /⠙ thinking\.\.\./);
    model.handle({ kind: "ctrlc" });
    assert.equal(first.signal.aborted, true);
    assert.match(paint(model), /cancelled/);
  });

  it("approves from the diff modal and denies an empty prompt with esc", async () => {
    const model = new TuiModel();
    const diff = "--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const approved = model.requestApproval("approve write to a.ts?", diff);
    const modal = paint(model);
    assert.match(modal, /approve write to a\.ts\?/);
    assert.match(modal, /\x1b\[32m\+new/);
    assert.match(modal, /y: approve/);
    assert.equal(model.handle({ kind: "text", text: "x" }).type, "none");
    model.handle({ kind: "text", text: "y" });
    assert.equal(await approved, true);
    assert.match(paint(model), /↳ approved/);

    const denied = model.requestApproval("approve?", "");
    assert.match(paint(model), /\? approve\? \(y\/n\)/);
    assert.doesNotMatch(paint(model), /y: approve/);
    model.handle({ kind: "esc" });
    assert.equal(await denied, false);
    assert.match(paint(model), /↳ denied/);
  });

  it("walks input history and writes it to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "harto-hist-"));
    const path = join(dir, "history");
    const first = new TuiModel({ historyPath: path, history: [] });
    first.handle({ kind: "text", text: "older" });
    first.handle({ kind: "enter" });
    first.finishTurn();
    first.handle({ kind: "text", text: "newer" });
    first.handle({ kind: "enter" });

    const second = new TuiModel({ historyPath: path, history: loadHistory(path) });
    second.handle({ kind: "up" });
    assert.match(paint(second), /❯ newer/);
    second.handle({ kind: "up" });
    assert.match(paint(second), /❯ older/);
    second.handle({ kind: "down" });
    assert.match(paint(second), /❯ newer/);
  });

  it("stops following the end after page up", () => {
    const model = new TuiModel({ width: 40, height: 24 });
    for (let i = 0; i < 40; i++) model.append(`line-${i}`);
    model.handle({ kind: "pgup" });
    model.append("ONLY-NEW");
    const frame = paint(model);
    assert.equal(frame.includes("ONLY-NEW"), false);
    assert.equal(frame.includes("line-39"), false);
    assert.equal(frame.includes("line-2"), true);
  });

  it("shows tokens when idle and the MCP server while connecting", () => {
    const model = new TuiModel({
      usage: () => usage({ inputTokens: 1200, outputTokens: 30, costUsd: 0.0123, reports: true }),
    });
    assert.match(paint(model), /1,200 in · 30 out · ~\$0\.0123/);
    model.noteMcp({ phase: "begin", total: 2 });
    model.noteMcp({ phase: "connecting", server: "git", total: 2 });
    assert.match(paint(model), /connecting MCP: git \(1\/2\)/);
  });

  it("opens the debug panel and the selected event", () => {
    const events = [event(1, "first"), event(2, "second", "{\"ok\":true}")];
    const model = new TuiModel({
      width: 80,
      height: 30,
      debugEnabled: () => true,
      debugSnapshot: () => events,
    });
    assert.match(paint(model), / debug/);
    assert.doesNotMatch(paint(model), /debug \*/);
    model.handle({ kind: "tab" });
    assert.match(paint(model), /debug \*/);
    assert.match(paint(model), /> #2 tool second/);
    model.handle({ kind: "up" });
    assert.match(paint(model), /> #1 tool first/);
    model.handle({ kind: "down" });
    model.handle({ kind: "enter" });
    const detail = paint(model);
    assert.match(detail, /#2 tool second/);
    assert.match(detail, /\{"ok":true\}/);
    assert.match(detail, /esc: back/);
  });
});
