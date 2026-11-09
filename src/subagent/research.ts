import { Agent } from "../agent/agent.ts";
import { consoleSink, type LineSink } from "../output.ts";
import type { Provider } from "../provider/provider.ts";
import type { Registry } from "../tool/registry.ts";
import type { Subagent, SubagentContext } from "./registry.ts";
import { beginSubagent } from "./tracker.ts";

const researchSystem = `You are a research subagent. Your job is to investigate the
task you're given and return a concise, factual answer.

Rules:
- Use the tools available to look up information. Prefer fewer, more targeted
  reads over scanning everything.
- Return a short answer with the specific facts requested. No preamble.
- If the answer requires a path or identifier, include it verbatim.
- You have a limited number of tool calls; do not waste them.`;

/**
 * Read-only investigator. Each run builds a fresh agent, so one delegation
 * cannot see what a previous one read.
 */
export class Research implements Subagent {
  provider: Provider;
  tools: Registry;
  write: LineSink;

  constructor(provider: Provider, tools: Registry, write: LineSink = consoleSink) {
    this.provider = provider;
    this.tools = tools;
    this.write = write;
  }

  name(): string {
    return "research";
  }

  description(): string {
    return (
      "Investigate the codebase or filesystem and return a focused answer. " +
      "Prefer this over reading files yourself when the user asks ANY question " +
      "about the code — 'where is X', 'how does Y work', 'what does Z look like'. " +
      "The subagent has read_file access and its own context window, so it can " +
      "explore freely without polluting your conversation. Always pass a concrete " +
      "task description, not just the user's literal question."
    );
  }

  async run(task: string, ctx: SubagentContext = {}): Promise<string> {
    const end = beginSubagent(this.name());
    try {
      const agent = new Agent(this.provider, researchSystem, this.tools, this.write);
      agent.name = this.name();
      agent.logPrefix = "  ↳ ";
      agent.quiet = true;
      agent.maxTurns = 10;
      agent.confirm = null;
      return await agent.send(task, { signal: ctx.signal });
    } finally {
      end();
    }
  }
}
