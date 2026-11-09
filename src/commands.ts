import type { Agent } from "./agent/agent.ts";
import { NoCompaction } from "./compact/strategy.ts";
import { SlidingWindow } from "./compact/sliding.ts";
import { Summarize } from "./compact/summarize.ts";
import { clearDebug, debugEnabled, findById, latest, setDebugEnabled, snapshot } from "./debug/debug.ts";
import type { LineSink } from "./output.ts";
import { apiKeyEnv, createProvider, isProviderName, knownModels, knownProviders } from "./provider/select.ts";
import type { TokenReporter } from "./provider/provider.ts";
import { notifyProviderChange, subagentRegistry } from "./subagent/registry.ts";
import { activeSubagents } from "./subagent/tracker.ts";
import { printCompaction } from "./ui/compaction.ts";

export interface CommandContext {
  agent: Agent;
  providerName: string;
  write: LineSink;
  requestExit(): void | Promise<void>;
}

interface Command {
  description: string;
  usage?: string;
  run(args: string, ctx: CommandContext): Promise<void> | void;
}

const commands = new Map<string, Command>([
  ["help", { description: "show available commands", run: cmdHelp }],
  ["provider", { description: "show or change the LLM provider", usage: "/provider [anthropic|openai|gemini]", run: cmdProvider }],
  ["model", { description: "show or change the model", usage: "/model [name]", run: cmdModel }],
  ["clear", { description: "clear conversation history", run: cmdClear }],
  ["tools", { description: "list available tools", run: cmdTools }],
  ["subagents", { description: "list subagents (registered and currently running)", run: cmdSubagents }],
  [
    "compact",
    {
      description: "run compaction now (optionally with a specific strategy)",
      usage: "/compact [sliding|summarize|none]",
      run: cmdCompact,
    },
  ],
  ["verbose", { description: "toggle printing of compaction before/after", usage: "/verbose [on|off]", run: cmdVerbose }],
  ["tokens", { description: "show cumulative token usage and estimated cost", run: cmdTokens }],
  [
    "debug",
    {
      description: "control the debug event panel (toggle / inspect entries)",
      usage: "/debug [on|off|clear|ls|show [id]]",
      run: cmdDebug,
    },
  ],
  ["exit", { description: "exit the harness", run: cmdExit }],
]);

/** True when the line was a slash command, including an unknown one. */
export async function runCommand(line: string, ctx: CommandContext): Promise<boolean> {
  if (!line.startsWith("/")) return false;
  const body = line.slice(1);
  const splitAt = body.indexOf(" ");
  const name = splitAt === -1 ? body : body.slice(0, splitAt);
  const args = splitAt === -1 ? "" : body.slice(splitAt + 1).trim();
  const command = commands.get(name);
  if (!command) {
    ctx.write(`unknown command: /${name} (try /help)`);
    return true;
  }
  await command.run(args, ctx);
  return true;
}

function cmdHelp(_args: string, ctx: CommandContext): void {
  ctx.write("available commands:");
  for (const name of [...commands.keys()].sort()) {
    const command = commands.get(name)!;
    const display = command.usage ?? `/${name}`;
    ctx.write(`  ${display.padEnd(22)} ${command.description}`);
  }
}

function cmdModel(args: string, ctx: CommandContext): void {
  if (args === "") {
    ctx.write(`current: ${ctx.agent.provider.model()}  (${ctx.providerName})`);
    const suggestions = isProviderName(ctx.providerName) ? knownModels[ctx.providerName] : undefined;
    if (suggestions) {
      ctx.write("suggestions:");
      for (const model of suggestions) ctx.write(`  ${model}`);
    }
    ctx.write("(or pass any model id — validated on next call)");
    return;
  }
  ctx.agent.provider.setModel(args);
  ctx.write(`model: ${args}`);
}

function cmdProvider(args: string, ctx: CommandContext): void {
  if (args === "") {
    ctx.write(`current: ${ctx.providerName}  (model: ${ctx.agent.provider.model()})`);
    ctx.write("choices:");
    for (const name of knownProviders) ctx.write(`  ${name}`);
    ctx.write("usage: /provider <name> [model]");
    return;
  }
  const parts = args.split(/\s+/);
  const name = parts[0] ?? "";
  const model = parts[1] ?? "";
  try {
    ctx.agent.provider = createProvider(name, model, ctx.agent.system);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.write(`provider: ${message}`);
    return;
  }
  ctx.providerName = name;
  notifyProviderChange(ctx.agent.provider);
  ctx.write(`provider: ${ctx.providerName}  (model: ${ctx.agent.provider.model()})`);
  if (isProviderName(name) && !process.env[apiKeyEnv(name)]) {
    ctx.write(`warning: ${apiKeyEnv(name)} is not set; the next call will fail`);
  }
}

function cmdClear(_args: string, ctx: CommandContext): void {
  ctx.agent.clearMessages();
  ctx.write("conversation cleared");
}

function cmdTools(_args: string, ctx: CommandContext): void {
  ctx.write("tools available:");
  for (const def of ctx.agent.tools.definitions()) {
    const tool = ctx.agent.tools.get(def.name);
    const origin = tool && isMcpTool(tool) ? " (mcp)" : "";
    ctx.write(`  ${def.name}${origin}  ${def.description}`);
  }
}

function cmdSubagents(_args: string, ctx: CommandContext): void {
  const registered = subagentRegistry.all();
  if (registered.length === 0) {
    ctx.write("no subagents registered");
  } else {
    ctx.write("registered subagents:");
    for (const subagent of registered) ctx.write(`  ${subagent.name()}  ${subagent.description()}`);
  }
  const running = activeSubagents();
  if (running.length === 0) {
    ctx.write("currently running: (none)");
    return;
  }
  ctx.write("currently running:");
  for (const { name, count } of running) {
    ctx.write(count === 1 ? `  ${name}` : `  ${name} ×${count}`);
  }
}

async function cmdCompact(args: string, ctx: CommandContext): Promise<void> {
  let strategy = ctx.agent.compactor;
  switch (args.toLowerCase()) {
    case "":
      break;
    case "sliding":
      strategy = new SlidingWindow(6);
      break;
    case "summarize":
      strategy = new Summarize(ctx.agent.provider, 0, 4, ctx.write);
      break;
    case "none":
      strategy = new NoCompaction();
      break;
    default:
      ctx.write(`unknown strategy: ${args} (try sliding, summarize, or none)`);
      return;
  }
  const before = ctx.agent.getMessages();
  let compacted;
  try {
    compacted = await strategy.compact(before);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.write(`compaction error: ${message}`);
    return;
  }
  ctx.agent.setMessages(compacted);
  ctx.write(`compacted: ${before.length} → ${compacted.length} messages`);
  if (ctx.agent.verbose && before.length !== compacted.length) {
    printCompaction(before, compacted, ctx.write);
  }
}

function cmdVerbose(args: string, ctx: CommandContext): void {
  switch (args.toLowerCase()) {
    case "":
      ctx.agent.verbose = !ctx.agent.verbose;
      break;
    case "on":
    case "true":
    case "yes":
      ctx.agent.verbose = true;
      break;
    case "off":
    case "false":
    case "no":
      ctx.agent.verbose = false;
      break;
    default:
      ctx.write(`unknown value: ${args} (try on/off)`);
      return;
  }
  ctx.write(`verbose: ${ctx.agent.verbose ? "on" : "off"}`);
}

function cmdTokens(_args: string, ctx: CommandContext): void {
  const reporter = asTokenReporter(ctx.agent.provider);
  if (!reporter) {
    ctx.write("this provider doesn't report token usage");
    return;
  }
  const usage = reporter.totalUsage();
  const cost = reporter.estimatedCostUsd();
  ctx.write("session usage:");
  ctx.write(`  input          ${formatThousands(usage.inputTokens)}`);
  ctx.write(`  output         ${formatThousands(usage.outputTokens)}`);
  if (usage.cacheCreationTokens > 0 || usage.cacheReadTokens > 0) {
    ctx.write(`  cache write    ${formatThousands(usage.cacheCreationTokens)}`);
    ctx.write(`  cache read     ${formatThousands(usage.cacheReadTokens)}`);
  }
  if (cost >= 0) ctx.write(`  est. cost      $${cost.toFixed(4)}`);
  else ctx.write("  est. cost      (unknown model — no rate)");
}

function cmdDebug(args: string, ctx: CommandContext): void {
  const parts = args === "" ? [] : args.split(/\s+/);
  const verb = (parts[0] ?? "").toLowerCase();
  const rest = parts[1] ?? "";
  switch (verb) {
    case "":
      setDebugEnabled(!debugEnabled());
      break;
    case "on":
    case "true":
    case "yes":
      setDebugEnabled(true);
      break;
    case "off":
    case "false":
    case "no":
      setDebugEnabled(false);
      break;
    case "clear":
      clearDebug();
      ctx.write("debug log cleared");
      return;
    case "ls":
    case "list":
      cmdDebugList(ctx);
      return;
    case "show":
    case "dump":
      cmdDebugShow(rest, ctx);
      return;
    default:
      ctx.write(`unknown value: ${verb} (try on/off/clear/ls/show)`);
      return;
  }
  ctx.write(`debug: ${debugEnabled() ? "on" : "off"}`);
}

function cmdDebugList(ctx: CommandContext): void {
  const events = snapshot();
  if (events.length === 0) {
    ctx.write("debug log is empty");
    return;
  }
  for (const event of events) {
    const marker = event.payload === "" ? " " : "•";
    ctx.write(`  ${marker} #${String(event.id).padEnd(4)} ${formatTime(event.time)} ${event.source.padEnd(10)} ${event.message}`);
  }
  ctx.write(`${events.length} events (• = has payload). use /debug show <id> for full content.`);
}

function cmdDebugShow(idText: string, ctx: CommandContext): void {
  const event = idText === "" ? latest() : findShown(idText, ctx);
  if (idText !== "" && !event) return;
  if (!event) {
    ctx.write("debug log is empty");
    return;
  }
  ctx.write(`#${event.id}  ${formatTime(event.time)}  ${event.source}  ${event.message}`);
  if (event.payload === "") {
    ctx.write("(no payload)");
    return;
  }
  ctx.write(highlightPayload(event.payload));
}

function findShown(idText: string, ctx: CommandContext) {
  const id = Number(idText);
  if (!Number.isInteger(id) || id < 0 || String(id) !== idText) {
    ctx.write(`not a valid id: ${idText}`);
    return undefined;
  }
  const event = findById(id);
  if (!event) ctx.write(`no event with id #${id} (it may have aged out of the ring)`);
  return event;
}

function cmdExit(_args: string, ctx: CommandContext): Promise<void> | void {
  return ctx.requestExit();
}

function asTokenReporter(provider: unknown): TokenReporter | null {
  if (typeof provider !== "object" || provider === null) return null;
  const candidate = provider as Partial<TokenReporter>;
  if (typeof candidate.totalUsage !== "function" || typeof candidate.estimatedCostUsd !== "function") return null;
  return candidate as TokenReporter;
}

/** MCP tools set this flag when that package exists. Local tools do not. */
function isMcpTool(tool: object): boolean {
  return (tool as { mcp?: boolean }).mcp === true;
}

function formatThousands(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(Math.trunc(value)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

function formatTime(date: Date): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`;
}

function highlightPayload(payload: string): string {
  try {
    JSON.parse(payload);
  } catch {
    return payload;
  }
  const pretty = JSON.stringify(JSON.parse(payload), null, 2);
  return pretty.replace(/("(?:\\.|[^"\\])*")(\s*:)?/g, (_match, text: string, colon?: string) => {
    if (colon) return `\x1b[36m${text}\x1b[0m${colon}`;
    return `\x1b[32m${text}\x1b[0m`;
  });
}
