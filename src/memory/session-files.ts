import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Entry } from "./store.ts";

interface SessionRecord {
  path: string;
  date: string;
  summary: string;
  tags: string[];
}

const preambleCount = 5;

/**
 * One markdown file per session under `.harto/sessions`, plus `index.json` for search.
 * save only appends a draft. Disk is touched in close, and a second close does not write again.
 */
export class SessionFiles {
  private root: string;
  private index: SessionRecord[] = [];
  private draft: Entry[] = [];
  private sessionStart: Date;

  private constructor(root: string, sessionStart: Date) {
    this.root = root;
    this.sessionStart = sessionStart;
  }

  static open(root: string, sessionStart = new Date()): SessionFiles {
    mkdirSync(join(root, "sessions"), { recursive: true });
    const store = new SessionFiles(root, sessionStart);
    store.loadIndex();
    store.pruneMissing();
    return store;
  }

  async save(entry: Entry): Promise<void> {
    const time = entry.time instanceof Date && !Number.isNaN(entry.time.getTime()) ? entry.time : new Date();
    this.draft.push({
      time,
      kind: entry.kind,
      content: entry.content,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
    });
  }

  async recall(query: string, limit: number): Promise<Entry[]> {
    const cap = limit <= 0 ? 5 : limit;
    const needle = query.trim().toLowerCase();
    const ranked = [...this.index].sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
    const hits: Entry[] = [];
    for (const record of ranked) {
      if (needle !== "" && !matches(record, needle)) continue;
      hits.push(recordToEntry(record));
      if (hits.length >= cap) break;
    }
    return hits;
  }

  async preamble(): Promise<string> {
    if (this.index.length === 0) return "";
    const ranked = [...this.index].sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
    const shown = ranked.slice(0, preambleCount);
    let out = "\n\n# Recent sessions (most recent first)\n\n";
    for (const record of shown) {
      const tags = record.tags.length > 0 ? ` (${record.tags.join(", ")})` : "";
      out += `- ${formatMinute(new Date(record.date))}${tags}: ${record.summary}\n`;
    }
    return out;
  }

  async close(): Promise<void> {
    if (this.draft.length === 0) return;
    const { summary, tags, body } = assemble(this.draft, this.sessionStart);
    const filename = `${formatStamp(this.sessionStart)}.md`;
    const relative = `sessions/${filename}`;
    writeFileSync(join(this.root, "sessions", filename), body, "utf8");
    this.index.push({
      path: relative,
      date: this.sessionStart.toISOString(),
      summary,
      tags,
    });
    this.flushIndex();
    this.draft = [];
  }

  private loadIndex(): void {
    const file = join(this.root, "index.json");
    if (!existsSync(file)) {
      this.index = [];
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`memory: parse index.json: ${message}`);
    }
    const sessions = (parsed as { sessions?: unknown }).sessions;
    if (!Array.isArray(sessions)) {
      throw new Error("memory: parse index.json: sessions is not an array");
    }
    this.index = sessions.map(readRecord);
  }

  private pruneMissing(): void {
    this.index = this.index.filter((record) => existsSync(join(this.root, record.path)));
  }

  private flushIndex(): void {
    const body = `${JSON.stringify({ sessions: this.index }, null, 2)}\n`;
    writeFileSync(join(this.root, "index.json"), body, "utf8");
  }
}

function readRecord(value: unknown): SessionRecord {
  const record = value as Partial<SessionRecord>;
  return {
    path: typeof record.path === "string" ? record.path : "",
    date: typeof record.date === "string" ? record.date : "",
    summary: typeof record.summary === "string" ? record.summary : "",
    tags: Array.isArray(record.tags) ? record.tags.filter((tag) => typeof tag === "string") : [],
  };
}

function matches(record: SessionRecord, needle: string): boolean {
  if (record.summary.toLowerCase().includes(needle)) return true;
  return record.tags.some((tag) => tag.toLowerCase().includes(needle));
}

function recordToEntry(record: SessionRecord): Entry {
  return {
    time: new Date(record.date),
    kind: "session-summary",
    content: `[${record.path}] ${record.summary}`,
    tags: record.tags,
  };
}

function assemble(draft: Entry[], sessionStart: Date): { summary: string; tags: string[]; body: string } {
  let summary = "(no summary)";
  let tags: string[] = [];
  const rest: Entry[] = [];
  for (const entry of draft) {
    if (entry.kind === "session-summary") {
      summary = entry.content;
      tags = entry.tags;
      continue;
    }
    rest.push(entry);
  }
  let body = `# ${formatMinute(sessionStart)}\n`;
  if (tags.length > 0) body += `tags: ${tags.join(", ")}\n`;
  body += `\n## Summary\n\n${summary}\n`;
  for (const kind of ["fact", "decision", "preference"] as const) {
    const entries = rest.filter((entry) => entry.kind === kind);
    if (entries.length === 0) continue;
    body += `\n## ${heading(kind)}\n\n`;
    for (const entry of entries) body += `- ${entry.content}\n`;
  }
  const extras = rest.filter((entry) => entry.kind !== "fact" && entry.kind !== "decision" && entry.kind !== "preference");
  if (extras.length > 0) {
    body += "\n## Notes\n\n";
    for (const entry of extras) {
      body += entry.kind === "" ? `- ${entry.content}\n` : `- (${entry.kind}) ${entry.content}\n`;
    }
  }
  return { summary, tags, body };
}

function heading(kind: "fact" | "decision" | "preference"): string {
  if (kind === "fact") return "Facts";
  if (kind === "decision") return "Decisions";
  return "Preferences";
}

function formatMinute(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}h${pad(date.getMinutes())}`;
}
