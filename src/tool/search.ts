import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { capOutput } from "./cap.ts";
import { insideProject } from "./paths.ts";
import type { Tool } from "./registry.ts";

const matchLimit = 80;
const fileLimit = 5000;
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

export const searchTool: Tool = {
  definition() {
    return {
      name: "search",
      description:
        "Search file contents under the working directory, or list paths when query is empty and glob is set. " +
        "Literal, case-insensitive. Prefer this over reading files one by one when looking for text. " +
        "Skips dependency folders, hidden directories, and binaries.",
      inputSchema: {
        query: { type: "string", description: "Text to find. Empty lists paths instead of searching contents." },
        path: { type: "string", description: "Directory to search. Defaults to the working directory." },
        glob: { type: "string", description: "Optional glob (* and ?) matched against the relative path." },
      },
      required: [],
    };
  },

  async execute(rawInput) {
    let query = "";
    let path = "";
    let glob = "";
    try {
      const parsed = JSON.parse(rawInput) as { query?: unknown; path?: unknown; glob?: unknown };
      if (parsed.query !== undefined && typeof parsed.query !== "string") {
        return { result: "invalid tool input: `query` must be a string", isError: true };
      }
      if (parsed.path !== undefined && typeof parsed.path !== "string") {
        return { result: "invalid tool input: `path` must be a string", isError: true };
      }
      if (parsed.glob !== undefined && typeof parsed.glob !== "string") {
        return { result: "invalid tool input: `glob` must be a string", isError: true };
      }
      query = parsed.query ?? "";
      path = parsed.path ?? "";
      glob = parsed.glob ?? "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `invalid tool input: ${message}`, isError: true };
    }
    if (query === "" && glob === "") return { result: "invalid tool input: provide `query` or `glob`", isError: true };

    const root = process.cwd();
    const start = path === "" ? root : insideProject(root, path);
    if (!start) return { result: "path is outside the working directory", isError: true };
    try {
      if (!statSync(start).isDirectory()) return { result: "path is not a directory", isError: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: message, isError: true };
    }

    const pattern = glob === "" ? null : globToRegExp(glob);
    const hits: string[] = [];
    walk(root, start, query, pattern, hits, { scanned: 0 });
    const note = hits.length >= matchLimit ? "\n[truncated]" : "";
    if (hits.length === 0) return { result: "no matches.", isError: false };
    return { result: capOutput(`${hits.join("\n")}${note}`), isError: false };
  },
};

function walk(
  root: string,
  dir: string,
  query: string,
  pattern: RegExp | null,
  hits: string[],
  progress: { scanned: number },
): void {
  if (hits.length >= matchLimit || progress.scanned >= fileLimit) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (hits.length >= matchLimit || progress.scanned >= fileLimit) return;
    if (entry.name.startsWith(".") || skipped.has(entry.name) || entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, query, pattern, hits, progress);
      continue;
    }
    if (!entry.isFile()) continue;
    progress.scanned += 1;
    const rel = relative(root, full).replaceAll("\\", "/");
    if (pattern && !pattern.test(rel)) continue;
    if (query === "") {
      hits.push(rel);
      continue;
    }
    collect(full, rel, query, hits);
  }
}

function collect(full: string, rel: string, query: string, hits: string[]): void {
  let data: Buffer;
  try {
    data = readFileSync(full);
  } catch {
    return;
  }
  if (data.subarray(0, 8000).includes(0)) return;
  const needle = query.toLowerCase();
  const lines = data.toString("utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (hits.length >= matchLimit) return;
    const line = lines[i] ?? "";
    if (!line.toLowerCase().includes(needle)) continue;
    const shown = line.length > 200 ? `${line.slice(0, 200)}…` : line;
    hits.push(`${rel}:${i + 1}: ${shown}`);
  }
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (const ch of glob.replaceAll("\\", "/")) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`, "i");
}
