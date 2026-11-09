import type { ToolDef } from "./api/types.ts";
import { consoleSink, type LineSink } from "./output.ts";
import type { Subagent } from "./subagent/registry.ts";
import type { Tool, ToolContext, ToolResult } from "./tool/registry.ts";

/** One subagent, exposed as delegate_<name>. Lives outside tool/ so it can import the agent loop. */
export class DelegateTool implements Tool {
  subagent: Subagent;
  write: LineSink;

  constructor(subagent: Subagent, write: LineSink = consoleSink) {
    this.subagent = subagent;
    this.write = write;
  }

  definition(): ToolDef {
    return {
      name: `delegate_${this.subagent.name()}`,
      description: this.subagent.description(),
      inputSchema: {
        task: {
          type: "string",
          description: "Concrete description of what the subagent should do.",
        },
      },
      required: ["task"],
    };
  }

  async execute(input: string, ctx: ToolContext): Promise<ToolResult> {
    let task: string;
    try {
      const parsed = JSON.parse(input) as { task?: unknown };
      if (typeof parsed.task !== "string") {
        return { result: "invalid tool input: `task` is required", isError: true };
      }
      task = parsed.task;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `invalid tool input: ${message}`, isError: true };
    }

    const name = this.subagent.name();
    this.write(`↳ delegating to ${name} subagent`);
    const start = Date.now();
    try {
      const result = await this.subagent.run(task, { signal: ctx.signal });
      this.write(`← ${name} subagent done (${formatElapsed(Date.now() - start)})`);
      return { result, isError: false };
    } catch (err) {
      this.write(`← ${name} subagent done (${formatElapsed(Date.now() - start)})`);
      const message = err instanceof Error ? err.message : String(err);
      return { result: `subagent error: ${message}`, isError: true };
    }
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(3).replace(/\.?0+$/, "")}s`;
}
