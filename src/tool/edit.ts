import { readFileSync, writeFileSync } from "node:fs";

import type { Tool } from "./registry.ts";

export interface EditPreview {
  path: string;
  before: string;
  after: string;
}

/** The file is unchanged. `error` means the snippet is missing or not unique. */
export function previewEdit(rawInput: string): EditPreview | { error: string } {
  let path = "";
  let oldText = "";
  let newText = "";
  try {
    const parsed = JSON.parse(rawInput) as { path?: unknown; old?: unknown; new?: unknown };
    if (typeof parsed.path !== "string" || parsed.path === "") return { error: "invalid tool input: `path` is required" };
    if (typeof parsed.old !== "string" || parsed.old === "") return { error: "invalid tool input: `old` must be a non-empty string" };
    if (typeof parsed.new !== "string") return { error: "invalid tool input: `new` is required" };
    path = parsed.path;
    oldText = parsed.old;
    newText = parsed.new;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `invalid tool input: ${message}` };
  }
  if (oldText === newText) return { error: "old and new are identical" };

  let before: string;
  try {
    before = readFileSync(path, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
  if (before.includes("\0")) return { error: "binary file" };
  const count = countOf(before, oldText);
  if (count === 0) return { error: "old string not found; include more surrounding context" };
  if (count > 1) return { error: `old string appears ${count} times; include more surrounding context` };
  return { path, before, after: before.replace(oldText, newText) };
}

export const editTool: Tool = {
  definition() {
    return {
      name: "edit",
      description:
        "Replace one unique snippet in an existing file. Use this for partial edits. " +
        "Use write_file to create a file or rewrite it whole. " +
        "`old` must match exactly once; include surrounding lines until it is unique.",
      inputSchema: {
        path: { type: "string", description: "Path of the file to edit." },
        old: { type: "string", description: "Exact snippet to replace. Must occur once." },
        new: { type: "string", description: "Replacement snippet. May be empty to delete the snippet." },
      },
      required: ["path", "old", "new"],
    };
  },

  async execute(rawInput) {
    const preview = previewEdit(rawInput);
    if ("error" in preview) return { result: preview.error, isError: true };
    try {
      writeFileSync(preview.path, preview.after);
      return { result: `edited ${preview.path}`, isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: message, isError: true };
    }
  },
};

function countOf(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
  return count;
}
