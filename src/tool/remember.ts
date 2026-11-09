import { getMemoryStore } from "../memory/store.ts";
import type { Tool } from "./registry.ts";

export const rememberTool: Tool = {
  definition() {
    return {
      name: "remember",
      description:
        "Record a fact, decision, or preference into persistent memory so it carries across sessions. Use sparingly for things the user genuinely wants to persist (project conventions, preferences, important decisions). Don't dump every tool call here.",
      inputSchema: {
        content: { type: "string", description: "The text to remember." },
        kind: { type: "string", description: "Optional category: fact (default), decision, preference." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional short tags to make the entry findable later via recall.",
        },
      },
      required: ["content"],
    };
  },

  async execute(rawInput) {
    let content = "";
    let kind = "fact";
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(rawInput) as { content?: unknown; kind?: unknown; tags?: unknown };
      if (typeof parsed.content !== "string" || parsed.content === "") {
        return { result: "remember: `content` is required", isError: true };
      }
      content = parsed.content;
      if (typeof parsed.kind === "string" && parsed.kind !== "") kind = parsed.kind;
      if (Array.isArray(parsed.tags)) tags = parsed.tags.filter((tag) => typeof tag === "string");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `invalid tool input: ${message}`, isError: true };
    }
    try {
      await getMemoryStore().save({ time: new Date(), kind, content, tags });
      return { result: "remembered.", isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: message, isError: true };
    }
  },
};
