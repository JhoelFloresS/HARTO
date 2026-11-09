import type { LineSink } from "../output.ts";
import { consoleSink } from "../output.ts";
import type { Provider } from "../provider/provider.ts";
import { DelegateTool } from "../delegate.ts";
import type { Registry } from "../tool/registry.ts";
import { subagentRegistry, type SubagentRegistry } from "./registry.ts";
import { Research } from "./research.ts";

/**
 * Rebuilds research against the current provider and refreshes its delegate tool.
 * Called at startup and again on /provider. Registering by name replaces the previous one.
 */
export function registerSubagents(
  provider: Provider,
  tools: Registry,
  write: LineSink = consoleSink,
  subagents: SubagentRegistry = subagentRegistry,
): void {
  subagents.register(new Research(provider, tools.subset("read_file"), write));
  for (const subagent of subagents.all()) {
    tools.register(new DelegateTool(subagent, write));
  }
}
