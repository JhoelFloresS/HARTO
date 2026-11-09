import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export interface MentionItem {
  path: string;
  kind: "file" | "dir";
}

const mentionLimit = 8;
const walkLimit = 4000;
const fileCap = 32 * 1024;
const skipped = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".harto",
  ".next",
  "target",
  "vendor",
  "__pycache__",
  "bin",
  "obj",
  "out",
  ".venv",
  "venv",
]);

/** The `@query` token that contains the cursor, if `@` starts that token. */
export function activeMention(input: string, cursor: number): { start: number; query: string } | null {
  const at = Math.max(0, Math.min(cursor, input.length));
  let start = at;
  while (start > 0 && !/\s/.test(input[start - 1] ?? "")) start -= 1;
  if ((input[start] ?? "") !== "@") return null;
  return { start, query: input.slice(start + 1, at) };
}

/** Best matches first. An empty query keeps the incoming order and cuts at the limit. */
export function filterMentions(items: MentionItem[], query: string, limit = mentionLimit): MentionItem[] {
  const needle = query.replaceAll("\\", "/").toLowerCase();
  if (needle === "") return items.slice(0, limit);
  const ranked: Array<{ item: MentionItem; score: number }> = [];
  for (const item of items) {
    const score = scorePath(item.path, needle);
    if (score === null) continue;
    ranked.push({ item, score });
  }
  ranked.sort((a, b) => a.score - b.score || a.item.path.length - b.item.path.length || a.item.path.localeCompare(b.item.path));
  return ranked.slice(0, limit).map((row) => row.item);
}

/** Replaces the active `@query` and leaves the cursor after a trailing space. */
export function insertMention(input: string, cursor: number, start: number, path: string): { input: string; cursor: number } {
  const body = path.includes(" ") ? `"${path.replaceAll("\"", "")}"` : path;
  const written = `@${body}`;
  let next = input.slice(0, start) + written + input.slice(cursor);
  let pos = start + written.length;
  if (next[pos] === " ") pos += 1;
  else {
    next = `${next.slice(0, pos)} ${next.slice(pos)}`;
    pos += 1;
  }
  return { input: next, cursor: pos };
}

/** Root entries first, then nested ones. Hidden directories and dependency folders are skipped. */
export function listProjectEntries(root: string, limit = walkLimit): MentionItem[] {
  const items: MentionItem[] = [];
  walk(root, root, items, limit);
  return items;
}

/**
 * Appends the files and folders referenced with `@`.
 * A path that does not stay inside `root` is left as text and not attached.
 */
export function expandMentions(text: string, root: string): string {
  const found = findMentions(text);
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const ref of found) {
    const key = ref.replaceAll("\\", "/");
    if (seen.has(key)) continue;
    seen.add(key);
    const block = renderMention(root, ref);
    if (block) blocks.push(block);
  }
  if (blocks.length === 0) return text;
  return `${text}\n\n${blocks.join("\n\n")}`;
}

function scorePath(path: string, needle: string): number | null {
  const norm = path.toLowerCase();
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  if (base === needle) return 0;
  if (base.startsWith(needle)) return 1;
  if (norm.includes(needle)) return 2;
  if (subsequence(norm, needle)) return 3;
  return null;
}

function subsequence(text: string, needle: string): boolean {
  let index = 0;
  for (const ch of text) {
    if (ch === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function walk(root: string, dir: string, items: MentionItem[], limit: number): void {
  if (items.length >= limit) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1;
    const bd = b.isDirectory() ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name);
  });
  const nested: string[] = [];
  for (const entry of entries) {
    if (items.length >= limit) return;
    if (entry.name.startsWith(".") || skipped.has(entry.name) || entry.isSymbolicLink()) continue;
    const rel = relative(root, join(dir, entry.name)).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      items.push({ path: rel, kind: "dir" });
      nested.push(join(dir, entry.name));
    } else if (entry.isFile()) {
      items.push({ path: rel, kind: "file" });
    }
  }
  for (const next of nested) walk(root, next, items, limit);
}

function findMentions(text: string): string[] {
  const found: string[] = [];
  const pattern = /(^|\s)@(?:"([^"\n]+)"|(\S+))/g;
  for (const match of text.matchAll(pattern)) {
    const path = match[2] ?? match[3] ?? "";
    if (path !== "") found.push(path);
  }
  return found;
}

function renderMention(root: string, ref: string): string | null {
  const located = locate(root, ref);
  if (!located) return null;
  const label = ref.replaceAll("\\", "/");
  if (located.kind === "dir") {
    const names = listDir(located.full);
    return `<folder path="${label}">\n${names.join("\n")}\n</folder>`;
  }
  return renderFile(located.full, label);
}

function locate(root: string, ref: string): { full: string; kind: "file" | "dir" } | null {
  if (ref.includes("\0") || isAbsolute(ref)) return null;
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return null;
  }
  const abs = resolve(rootReal, ref);
  let full: string;
  try {
    full = realpathSync(abs);
  } catch {
    return null;
  }
  const rel = relative(rootReal, full);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  try {
    const info = statSync(full);
    if (info.isDirectory()) return { full, kind: "dir" };
    if (info.isFile()) return { full, kind: "file" };
  } catch {
    return null;
  }
  return null;
}

function listDir(dir: string): string[] {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });
    return entries.slice(0, 200).map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [`(unreadable: ${message})`];
  }
}

function renderFile(full: string, label: string): string {
  let data: Buffer;
  try {
    data = readFileSync(full);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `<file path="${label}">\n(unreadable: ${message})\n</file>`;
  }
  if (data.subarray(0, 8000).includes(0)) return `<file path="${label}">\n(binary, contents omitted)\n</file>`;
  const text = data.toString("utf8");
  const body = text.length > fileCap ? `${text.slice(0, fileCap)}\n… (truncated)` : text;
  return `<file path="${label}">\n${body}\n</file>`;
}
