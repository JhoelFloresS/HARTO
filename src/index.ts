import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { join } from "node:path";

import { Agent } from "./agent/agent.ts";
import type { CommandContext } from "./commands.ts";
import { debugEnabled, setDebugEnabled, snapshot } from "./debug/debug.ts";
import { loadEnvFile } from "./env.ts";
import { loadConfig } from "./mcp/config.ts";
import { noteMcpProgress, type McpProgress, type McpProgressState } from "./mcp/progress.ts";
import { registerMcp } from "./mcp/register.ts";
import type { McpSession } from "./mcp/session.ts";
import { SessionFiles } from "./memory/session-files.ts";
import { summarizeSession } from "./memory/summarize.ts";
import { setMemoryStore } from "./memory/store.ts";
import { consoleSink, type LineSink } from "./output.ts";
import { baseSystemPrompt, loadAgentsContext } from "./prompt.ts";
import { expandMentions, listProjectEntries } from "./mention/mention.ts";
import { detectProject, projectLabel, projectPrompt, resolveProject, unknownProject, type Project } from "./project/project.ts";
import type { TokenReporter } from "./provider/provider.ts";
import { createProvider } from "./provider/select.ts";
import { shutdown, onShutdown } from "./shutdown.ts";
import { onProviderChange } from "./subagent/registry.ts";
import { activeSubagents } from "./subagent/tracker.ts";
import { registerSubagents } from "./subagent/wire.ts";
import { defaultRegistry } from "./tool/register.ts";
import { historyPath, loadHistory } from "./ui/history.ts";
import { runRepl } from "./ui/repl.ts";
import { runCommand } from "./commands.ts";
import { runTui } from "./ui/run-tui.ts";
import { TuiModel, type UsageSnapshot } from "./ui/tui.ts";

export { Agent } from "./agent/agent.ts";
export { createProvider } from "./provider/select.ts";
export { defaultRegistry } from "./tool/register.ts";

export function launchedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href || sameFile(import.meta.url, pathToFileURL(entry).href);
  } catch {
    return sameFile(import.meta.url, pathToFileURL(entry).href);
  }
}

function sameFile(left: string, right: string): boolean {
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

export async function startHarness(): Promise<void> {
  const project = await openProject();
  if (!project) {
    process.exit(0);
    return;
  }
  process.chdir(project.root);
  const label = projectLabel(project);

  loadEnvFile();
  let system = baseSystemPrompt + projectPrompt(project) + loadAgentsContext();
  let sessions: SessionFiles | null = null;
  try {
    sessions = SessionFiles.open(".harto");
    setMemoryStore(sessions);
    system += await sessions.preamble();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`memory: ${message} (continuing without persistent memory)\n`);
  }

  const requested = process.env.LLM_PROVIDER || "anthropic";
  let providerName = requested;
  let provider;
  try {
    provider = createProvider(requested, process.env.LLM_MODEL ?? "", system);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`provider: ${message} (falling back to anthropic)\n`);
    providerName = "anthropic";
    provider = createProvider("anthropic", "", system);
  }
  if (envTruthy(process.env.HARNESS_DEBUG)) setDebugEnabled(true);

  const useTui = process.stdin.isTTY === true && process.env.HARTO_REPL !== "1";
  let screen: TuiModel | null = null;
  const sink: LineSink = (line) => {
    if (screen) screen.append(line);
    else consoleSink(line);
  };

  registerSubagents(provider, defaultRegistry, sink);
  const agent = new Agent(provider, system, defaultRegistry, sink);
  agent.maxTurns = 50;
  onProviderChange((next) => {
    registerSubagents(next, defaultRegistry, agent.write);
  });
  if (useTui) {
    const file = historyPath();
    screen = new TuiModel({
      historyPath: file,
      history: loadHistory(file),
      usage: () => readUsage(agent),
      subagents: activeSubagents,
      debugEnabled,
      debugSnapshot: snapshot,
      project: label,
      mentions: () => listProjectEntries(process.cwd()),
    });
    agent.confirm = (prompt, detail) => screen!.requestApproval(prompt, detail);
  }

  const mcpAbort = new AbortController();
  const mcpClients: McpSession[] = [];
  const mcpState: McpProgressState = { finished: 0, failed: 0 };
  const mcpTask = connectMcp(mcpAbort.signal, mcpClients, (event) => {
    if (screen) {
      screen.noteMcp(event);
      return;
    }
    const line = noteMcpProgress(event, mcpState);
    if (line && !mcpAbort.signal.aborted) consoleSink(line);
  });
  onShutdown(async () => {
    mcpAbort.abort();
    await mcpTask;
    for (const client of mcpClients) {
      try {
        await client.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`mcp: close: ${message}\n`);
      }
    }
  });

  if (sessions) {
    const memory = sessions;
    onShutdown(async () => {
      const history = agent.getMessages();
      if (history.length > 0) {
        const parsed = await summarizeSession(agent.provider, history);
        await memory.save({
          time: new Date(),
          kind: "session-summary",
          content: parsed.summary,
          tags: parsed.tags,
        });
      }
      await memory.close();
    });
  }
  const ctx: CommandContext = {
    agent,
    providerName,
    write: sink,
    requestExit() {
      return shutdown().then(() => {
        process.exit(0);
      });
    },
  };

  try {
    if (screen) {
      await runTui(screen, async (line, signal) => {
        if (!(await runCommand(line, ctx))) await agent.send(expandMentions(line, process.cwd()), { signal });
      });
    } else {
      await runRepl(ctx, label);
    }
  } finally {
    await shutdown();
  }
}

function envTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/** Asks only when the directory has no marker and someone is at the keyboard. */
async function openProject(): Promise<Project | null> {
  const dir = process.cwd();
  if (process.stdin.isTTY !== true) return detectProject(dir) ?? unknownProject(dir);
  try {
    const found = detectProject(dir);
    if (found) return found;
  } catch {
    // resolveProject reports the unreadable directory and asks for another path.
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await resolveProject(dir, {
      ask: (prompt) => rl.question(prompt),
      write: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    rl.close();
  }
}

/** Starts after the call returns its promise, so the UI can paint before any server answers. */
function connectMcp(
  signal: AbortSignal,
  clients: McpSession[],
  onProgress: (event: McpProgress) => void,
): Promise<void> {
  return loadConfig(join(process.cwd(), "mcp.json"))
    .then((config) => registerMcp(config, defaultRegistry, { signal, progress: onProgress }))
    .then((opened) => {
      clients.push(...opened);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`mcp: config error: ${message}\n`);
    });
}

function readUsage(agent: Agent): UsageSnapshot {
  const provider = agent.provider as Partial<TokenReporter>;
  if (typeof provider.totalUsage !== "function" || typeof provider.estimatedCostUsd !== "function") {
    return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: -1, reports: false };
  }
  const usage = provider.totalUsage();
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: provider.estimatedCostUsd(),
    reports: true,
  };
}

if (launchedDirectly()) {
  startHarness().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
