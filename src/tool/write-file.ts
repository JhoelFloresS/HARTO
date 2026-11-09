import { writeFile } from "node:fs/promises";

import type { Tool } from "./registry.ts";

export const writeFileTool: Tool = {
  definition() {
    return {
      name: "write_file",
      description: "Write content to a file at the given path. Creates or overwrites.",
      inputSchema: {
        path: {
          type: "string",
          description: "Path to the file to write.",
        },
        content: {
          type: "string",
          description: "The content to write.",
        },
      },
      required: ["path", "content"],
    };
  },

  async execute(rawInput) {
    let path: string;
    let content: string;
    try {
      const parsed = JSON.parse(rawInput) as { path?: unknown; content?: unknown };
      if (typeof parsed.path !== "string" || parsed.path === "") {
        return { result: "invalid tool input: `path` is required", isError: true };
      }
      if (typeof parsed.content !== "string") {
        return { result: "invalid tool input: `content` is required", isError: true };
      }
      path = parsed.path;
      content = parsed.content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `invalid tool input: ${message}`, isError: true };
    }

    try {
      await writeFile(path, content);
      return { result: `wrote ${Buffer.byteLength(content)} bytes to ${path}`, isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: message, isError: true };
    }
  },
};
