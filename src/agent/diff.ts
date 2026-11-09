import { readFileSync } from "node:fs";

interface WriteInput {
  path: string;
  content: string;
}

function parseWrite(rawInput: string): WriteInput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if ("path" in obj && obj.path !== undefined && typeof obj.path !== "string") return null;
  if ("content" in obj && obj.content !== undefined && typeof obj.content !== "string") return null;
  return {
    path: typeof obj.path === "string" ? obj.path : "",
    content: typeof obj.content === "string" ? obj.content : "",
  };
}

export function extractWritePath(rawInput: string): string {
  return parseWrite(rawInput)?.path ?? "";
}

/**
 * Unified diff of a proposed write_file, shown before the tool runs.
 * Empty string means the input could not be parsed; the caller falls back
 * to a plain approve prompt.
 */
export function buildWriteDiff(rawInput: string): string {
  const input = parseWrite(rawInput);
  if (!input) return "";

  let existing: string | null = null;
  try {
    existing = readFileSync(input.path, "utf8");
  } catch {
    existing = null;
  }

  if (existing === null) return synthesizeNewFileDiff(input.path, input.content);
  const diff = unifiedDiff(
    `${input.path} (current)`,
    `${input.path} (proposed)`,
    splitLines(existing),
    splitLines(input.content),
  );
  if (diff === "") return "(no changes: proposed content is identical to current file)\n";
  return diff;
}

function synthesizeNewFileDiff(path: string, content: string): string {
  const lines = splitLines(content);
  let out = "--- /dev/null\n";
  out += `+++ ${path} (new file)\n`;
  out += `@@ -0,0 +1,${lines.length} @@\n`;
  for (const line of lines) {
    out += `+${line.endsWith("\n") ? line : `${line}\n`}`;
  }
  return out;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

type Op = { kind: "eq" | "del" | "ins"; line: string };

function lineDiff(before: string[], after: string[]): Op[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: "eq", line: before[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "del", line: before[i] });
      i++;
    } else {
      ops.push({ kind: "ins", line: after[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", line: before[i++] });
  while (j < m) ops.push({ kind: "ins", line: after[j++] });
  return ops;
}

function unifiedDiff(fromLabel: string, toLabel: string, before: string[], after: string[], context = 3): string {
  const ops = lineDiff(before, after);
  if (ops.every((op) => op.kind === "eq")) return "";

  const show = ops.map((op) => op.kind !== "eq");
  for (let i = 0; i < ops.length; i++) {
    if (!show[i]) continue;
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length - 1, i + context);
    for (let j = from; j <= to; j++) show[j] = true;
  }

  let body = "";
  let i = 0;
  while (i < ops.length) {
    if (!show[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && show[j]) j++;
    body += formatHunk(ops, i, j);
    i = j;
  }
  return `--- ${fromLabel}\n+++ ${toLabel}\n${body}`;
}

function formatHunk(ops: Op[], start: number, end: number): string {
  let aLine = 1;
  let bLine = 1;
  for (let k = 0; k < start; k++) {
    if (ops[k].kind !== "ins") aLine++;
    if (ops[k].kind !== "del") bLine++;
  }
  let aCount = 0;
  let bCount = 0;
  for (let k = start; k < end; k++) {
    if (ops[k].kind !== "ins") aCount++;
    if (ops[k].kind !== "del") bCount++;
  }
  let out = `@@ -${aLine},${aCount} +${bLine},${bCount} @@\n`;
  for (let k = start; k < end; k++) {
    const prefix = ops[k].kind === "eq" ? " " : ops[k].kind === "del" ? "-" : "+";
    const line = ops[k].line.endsWith("\n") ? ops[k].line : `${ops[k].line}\n`;
    out += prefix + line;
  }
  return out;
}
