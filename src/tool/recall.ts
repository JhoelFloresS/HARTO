import { getMemoryStore } from "../memory/store.ts";
import type { Tool } from "./registry.ts";

export const recallTool: Tool = {
  definition() {
    return {
      name: "recall",
      description:
        "Search persistent memory of past sessions. Returns dates, tags, summaries, and file paths — read_file on a returned path to see the full transcript. Recent sessions are already in the system prompt; check there first.",
      inputSchema: {
        query: { type: "string", description: "Substring to match against session tags and summaries (case-insensitive)." },
        limit: { type: "integer", description: "Maximum number of session records to return. Defaults to 5." },
      },
      required: ["query"],
    };
  },

  async execute(rawInput) {
    let query = "";
    let limit = 5;
    try {
      const parsed = JSON.parse(rawInput) as { query?: unknown; limit?: unknown };
      if (typeof parsed.query !== "string" || parsed.query === "") {
        return { result: "recall: `query` is required", isError: true };
      }
      query = parsed.query;
      if (typeof parsed.limit === "number" && parsed.limit > 0) limit = parsed.limit;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `invalid tool input: ${message}`, isError: true };
    }
    try {
      const entries = await getMemoryStore().recall(query, limit);
      if (entries.length === 0) return { result: "no matches.", isError: false };
      let out = `${entries.length} match(es) for "${query}":\n`;
      for (const entry of entries) {
        const tags = entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
        out += `- ${formatDay(entry.time)} — ${entry.content}${tags}\n`;
      }
      return { result: out, isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: message, isError: true };
    }
  },
};

function formatDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
