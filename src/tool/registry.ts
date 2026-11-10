import type { ToolDef } from "../api/types.ts";

export interface ToolContext {
  signal?: AbortSignal;
}

export interface ToolResult {
  result: string;
  isError: boolean;
}

export interface Tool {
  definition(): ToolDef;
  execute(input: string, ctx: ToolContext): Promise<ToolResult>;
}

export class Registry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.definition().name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** A new registry with only the named tools. Unknown names are ignored. */
  subset(...names: string[]): Registry {
    const out = new Registry();
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) out.register(tool);
    }
    return out;
  }

  /** Drops tools that match. Used to forget MCP tools when the project changes. */
  drop(predicate: (tool: Tool) => boolean): void {
    for (const [name, tool] of this.tools) {
      if (predicate(tool)) this.tools.delete(name);
    }
  }

  /** Sorted by name so consecutive requests serialize the same tool list. */
  definitions(): ToolDef[] {
    return [...this.tools.keys()].sort().map((name) => this.tools.get(name)!.definition());
  }

  async execute(name: string, input: string, ctx: ToolContext = {}): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { result: `unknown tool: ${name}`, isError: true };
    return tool.execute(input, ctx);
  }
}
