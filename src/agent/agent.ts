import {
  isThoughtBlock,
  renderTranscript,
  type Block,
  type Message,
} from "../api/types.ts";
import { NoCompaction, type CompactionStrategy } from "../compact/strategy.ts";
import { recordfc, recordp, recordpc, type Level } from "../debug/debug.ts";
import { consoleSink, type LineSink } from "../output.ts";
import type { PermissionPolicy } from "../permission/policy.ts";
import type { Provider, SendContext } from "../provider/provider.ts";
import type { Registry } from "../tool/registry.ts";
import { previewEdit } from "../tool/edit.ts";
import { buildWriteDiff, extractWritePath } from "./diff.ts";

export class MaxTurnsError extends Error {
  readonly agentText: string;

  constructor(maxTurns: number, agentText: string) {
    super(`max turns (${maxTurns}) reached`);
    this.name = "MaxTurnsError";
    this.agentText = agentText;
  }
}

/**
 * One conversation. The root REPL and each subagent own a separate instance.
 * Tool failures come back as tool results; they do not throw out of the loop.
 */
export class Agent {
  name = "";
  provider: Provider;
  tools: Registry;
  compactor: CompactionStrategy;
  system: string;
  maxTurns = 20;
  verbose = false;
  logPrefix = "";
  quiet = false;
  /** Null auto-approves. Subagents leave this null so they don't block on the UI. */
  confirm: ((prompt: string, detail: string) => boolean | Promise<boolean>) | null = null;
  /** Null asks whenever confirm is set. The root installs an AllowList. */
  policy: PermissionPolicy | null = null;
  /** Live text. Set by the UI. Thought blocks never come through here. */
  onDelta: ((delta: string) => void) | null = null;
  write: LineSink;

  private messages: Message[] = [];
  private pendingLine = false;

  constructor(provider: Provider, system: string, tools: Registry, write: LineSink = consoleSink) {
    this.provider = provider;
    this.system = system;
    this.tools = tools;
    this.compactor = new NoCompaction();
    this.write = write;
  }

  getMessages(): Message[] {
    return this.messages;
  }

  setMessages(messages: Message[]): void {
    this.messages = messages;
  }

  clearMessages(): void {
    this.messages = [];
  }

  async send(prompt: string, ctx: SendContext = {}): Promise<string> {
    this.messages.push({
      role: "user",
      content: [{ type: "text", text: prompt }],
    });
    return this.loop(ctx);
  }

  private async loop(ctx: SendContext): Promise<string> {
    let finalText = "";

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const before = this.messages;
      try {
        const compacted = await this.compactor.compact(before);
        if (compacted.length !== before.length) {
          const summary = `${this.compactorName()}: ${before.length} → ${compacted.length} msgs`;
          const payload =
            `--- before (${before.length} msgs) ---\n${renderTranscript(before)}` +
            `\n--- after (${compacted.length} msgs) ---\n${renderTranscript(compacted)}`;
          recordp("compact", "info", summary, payload);
          if (this.verbose) {
            this.write(`--- compaction: ${before.length} → ${compacted.length} ---`);
            this.write(renderTranscript(before));
            this.write("---");
            this.write(renderTranscript(compacted));
            this.write("---");
          }
        }
        this.messages = compacted;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.write(`${this.logPrefix}compaction error: ${message} (continuing without)`);
        recordp("compact", "error", `${this.compactorName()}: ${message}`, renderTranscript(before));
      }

      let response;
      let streamed = false;
      try {
        response = await this.provider.send(this.messages, this.tools.definitions(), {
          signal: ctx.signal,
          system: this.system,
          onText: this.quiet
            ? undefined
            : (delta) => {
                streamed = true;
                this.feed(delta);
              },
        });
      } catch (err) {
        if (err instanceof Error) {
          (err as Error & { agentText?: string }).agentText = finalText;
        }
        throw err;
      }

      this.messages.push({ role: "assistant", content: response.content });

      const toolResults: Block[] = [];
      let hasToolCall = false;

      for (const block of response.content) {
        if (block.type === "text") {
          if (!block.text) continue;
          if (isThoughtBlock(block)) continue;
          if (!this.quiet && !streamed) this.write(block.text);
          finalText += `${block.text}\n`;
          continue;
        }
        if (block.type === "tool_use") {
          hasToolCall = true;
          const { result, isError } = await this.executeTool(block.toolName ?? "", block.toolInput ?? "", ctx);
          toolResults.push({
            type: "tool_result",
            toolUseId: block.toolUseId,
            toolResult: result,
            isError,
          });
        }
      }

      if (response.stopReason !== "tool_use" || !hasToolCall) {
        this.breakStream();
        return finalText.trim();
      }

      this.messages.push({ role: "user", content: toolResults });
    }

    throw new MaxTurnsError(this.maxTurns, finalText.trim());
  }

  private async executeTool(
    name: string,
    rawInput: string,
    ctx: SendContext,
  ): Promise<{ result: string; isError: boolean }> {
    this.breakStream();
    this.write(`${this.logPrefix}[tool] ${name} ${rawInput}`);
    const source = this.name === "" ? "tool" : `tool/${this.name}`;
    const reqId = recordp(source, "info", `→ ${name} ${truncate(rawInput, 200)}`, rawInput);

    const decision = this.policy ? this.policy.decide(name, rawInput) : { decision: "ask" as const, reason: "" };
    if (decision.decision === "deny") {
      const reason = decision.reason === "" ? "permission policy denied this tool call" : decision.reason;
      recordfc(reqId, source, "warn", "denied: %s", name);
      return { result: reason, isError: true };
    }

    let prompt = "approve?";
    let detail = "";
    if (name === "write_file") {
      const diff = buildWriteDiff(rawInput);
      if (diff !== "") {
        detail = diff;
        const path = extractWritePath(rawInput);
        prompt = path === "" ? "approve write?" : `approve write to ${path}?`;
      }
    } else if (name === "edit") {
      const preview = previewEdit(rawInput);
      if ("error" in preview) {
        recordpc(reqId, source, "error", `← ${name} error: ${truncate(preview.error, 200)}`, preview.error);
        return { result: preview.error, isError: true };
      }
      detail = buildWriteDiff(JSON.stringify({ path: preview.path, content: preview.after }));
      prompt = `approve edit to ${preview.path}?`;
    } else if (name === "cmd") {
      prompt = "approve command?";
      detail = commandText(rawInput);
    }

    if (decision.decision === "ask" && this.confirm && !(await this.confirm(prompt, detail))) {
      recordfc(reqId, source, "warn", "denied: %s", name);
      return { result: "user denied this tool call", isError: true };
    }

    const start = Date.now();
    const { result, isError } = await this.tools.execute(name, rawInput, { signal: ctx.signal });
    const elapsed = Date.now() - start;
    let level: Level = "info";
    let verdict = `← ${name} (${elapsed}ms, ${Buffer.byteLength(result)} bytes)`;
    if (isError) {
      level = "error";
      verdict = `← ${name} error (${elapsed}ms): ${truncate(result, 200)}`;
    }
    recordpc(reqId, source, level, verdict, result);
    return { result, isError };
  }

  private feed(delta: string): void {
    if (delta === "") return;
    this.pendingLine = !delta.endsWith("\n");
    this.onDelta?.(delta);
  }

  private breakStream(): void {
    if (!this.pendingLine) return;
    this.onDelta?.("\n");
    this.pendingLine = false;
  }

  private compactorName(): string {
    return this.compactor.constructor?.name || "none";
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function commandText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { command?: unknown };
    if (typeof parsed.command === "string") return parsed.command;
  } catch {
    // The modal still shows the raw input.
  }
  return raw;
}
