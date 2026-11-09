import { readFile } from "node:fs/promises";

import { capOutput } from "./cap.ts";
import type { Tool } from "./registry.ts";

export const readFileTool: Tool = {
  definition() {
    return {
      name: "read_file",
      description: "Read the contents of a file at the given path.",
      inputSchema: {
        path: {
          type: "string",
          description: "Path to the file to read.",
        },
      },
      required: ["path"],
    };
  },

  async execute(rawInput) {
    let path: string;
    try {
      const parsed = JSON.parse(rawInput) as { path?: unknown };
      if (typeof parsed.path !== "string" || parsed.path === "") {
        return { result: "invalid tool input: `path` is required", isError: true };
      }
      path = parsed.path;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `invalid tool input: ${message}`, isError: true };
    }

    try {
      const data = await readFile(path, "utf8");
      return { result: capOutput(data), isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: message, isError: true };
    }
  },
};
