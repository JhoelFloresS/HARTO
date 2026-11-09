import { addUsage, emptyUsage, isThoughtBlock, type Block, type Message, type Response, type ToolDef, type Usage } from "../api/types.ts";
import { recordfc, recordp, recordpc } from "../debug/debug.ts";
import { marshalRequestPayload, marshalResponsePayload } from "./payloads.ts";
import type { Provider, SendContext, TokenReporter } from "./provider.ts";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-4-7";
const defaultMaxTokens = 8192;

/**
 * Standard tier, USD per million tokens. Cache write is the 5-minute rate.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing (read 2026-11-05).
 * input_tokens already excludes cache tokens, so each field is priced on its own.
 * 1-hour cache writes cost more and are unused: this adapter does not send cache_control.
 */
const modelPricing: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-4-7": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

export type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

/** The slice of messages.create this adapter depends on. Tests fake this, not the SDK. */
export interface AnthropicRequest {
  model: string;
  maxTokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  thinking: { type: "adaptive" };
  signal?: AbortSignal;
}

export interface AnthropicUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface AnthropicResult {
  content: AnthropicBlock[];
  stopReason?: string;
  usage?: AnthropicUsage;
}

export interface AnthropicClient {
  create(request: AnthropicRequest): Promise<AnthropicResult>;
}

interface AnthropicMeta {
  thought?: boolean;
  kind?: "thinking" | "redacted_thinking";
  signature?: string;
  data?: string;
}

type AnthropicCtor = new (options: { apiKey?: string }) => {
  messages: {
    create(
      body: {
        model: string;
        max_tokens: number;
        system?: string;
        messages: AnthropicMessage[];
        tools?: AnthropicTool[];
        thinking: { type: "adaptive" };
      },
      options: { signal?: AbortSignal },
    ): Promise<{
      stop_reason?: string | null;
      content?: Array<{
        type?: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
        thinking?: string;
        signature?: string;
        data?: string;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    }>;
  };
};

/**
 * Loaded only when a real call is made. A static import would force every test
 * that touches this module to have @anthropic-ai/sdk installed.
 */
async function createSdkClient(): Promise<AnthropicClient> {
  const specifier = "@anthropic-ai/sdk";
  const loaded = (await import(specifier)) as { default: AnthropicCtor };
  const client = new loaded.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  return {
    async create(request) {
      const response = await client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          ...(request.system ? { system: request.system } : {}),
          messages: request.messages,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
          thinking: request.thinking,
        },
        { signal: request.signal },
      );
      return {
        stopReason: response.stop_reason ?? undefined,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          cacheCreationInputTokens: response.usage?.cache_creation_input_tokens,
          cacheReadInputTokens: response.usage?.cache_read_input_tokens,
        },
        content: (response.content ?? []).flatMap(fromSdkBlock),
      };
    },
  };
}

function fromSdkBlock(block: {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  signature?: string;
  data?: string;
}): AnthropicBlock[] {
  if (block.type === "text") return [{ type: "text", text: block.text ?? "" }];
  if (block.type === "tool_use") {
    const input = block.input;
    return [
      {
        type: "tool_use",
        id: block.id ?? "",
        name: block.name ?? "",
        input: typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
      },
    ];
  }
  if (block.type === "thinking") {
    return [{ type: "thinking", thinking: block.thinking ?? "", signature: block.signature ?? "" }];
  }
  if (block.type === "redacted_thinking") {
    return [{ type: "redacted_thinking", data: block.data ?? "" }];
  }
  return [];
}

export class AnthropicProvider implements Provider, TokenReporter {
  private modelName: string;
  private readonly system: string;
  private readonly client?: AnthropicClient;
  private readonly maxTokens: number;
  private total: Usage = emptyUsage();
  private clientPromise: Promise<AnthropicClient> | null = null;

  constructor(model: string, system: string, client?: AnthropicClient, maxTokens = defaultMaxTokens) {
    // Parameter properties are rejected by Node's type stripper, so fields are assigned here.
    this.modelName = model === "" ? ANTHROPIC_DEFAULT_MODEL : model;
    this.system = system;
    this.client = client;
    this.maxTokens = maxTokens;
  }

  model(): string {
    return this.modelName;
  }

  setModel(name: string): void {
    this.modelName = name;
  }

  totalUsage(): Usage {
    return { ...this.total };
  }

  estimatedCostUsd(): number {
    const rates = modelPricing[this.modelName];
    if (!rates) return -1;
    const usage = this.total;
    return (
      (usage.inputTokens * rates.input +
        usage.outputTokens * rates.output +
        usage.cacheCreationTokens * rates.cacheWrite +
        usage.cacheReadTokens * rates.cacheRead) /
      1_000_000
    );
  }

  async send(messages: Message[], tools: ToolDef[], ctx: SendContext = {}): Promise<Response> {
    // Copied before the await. Usage is added in one assignment afterwards, so
    // setModel or another send cannot tear it: that assignment does not yield.
    const model = this.modelName;
    const system = ctx.system ?? this.system;
    const request = toRequest(model, system, this.maxTokens, messages, tools, ctx.signal);
    const reqId = recordp(
      "provider",
      "info",
      `→ anthropic.Send model=${model} msgs=${messages.length} tools=${tools.length}`,
      marshalRequestPayload(model, system, this.maxTokens, messages, tools),
    );
    const start = Date.now();
    try {
      const client = this.client ?? (await this.sdk());
      const raw = await client.create(request);
      const response = fromResult(raw);
      this.total = addUsage(this.total, response.usage);
      const elapsed = Date.now() - start;
      recordpc(
        reqId,
        "provider",
        "info",
        `← anthropic.Send (${elapsed}ms in=${response.usage.inputTokens} out=${response.usage.outputTokens} cache=${response.usage.cacheCreationTokens}/${response.usage.cacheReadTokens} stop=${response.stopReason})`,
        marshalResponsePayload(response, elapsed),
      );
      return response;
    } catch (err) {
      const elapsed = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      recordfc(reqId, "provider", "error", "← anthropic.Send error (%sms): %s", elapsed, message);
      throw err;
    }
  }

  private sdk(): Promise<AnthropicClient> {
    this.clientPromise ??= createSdkClient();
    return this.clientPromise;
  }
}

function toRequest(
  model: string,
  system: string,
  maxTokens: number,
  messages: Message[],
  tools: ToolDef[],
  signal?: AbortSignal,
): AnthropicRequest {
  return {
    model,
    maxTokens,
    ...(system === "" ? {} : { system }),
    messages: toMessages(messages),
    tools: toTools(tools),
    thinking: { type: "adaptive" },
    signal,
  };
}

function toTools(tools: ToolDef[]): AnthropicTool[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: tool.inputSchema,
      required: tool.required,
    },
  }));
}

function toMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    const content = toBlocks(message);
    if (content.length === 0) continue;
    out.push({ role: message.role, content });
  }
  return out;
}

function toBlocks(message: Message): AnthropicBlock[] {
  const blocks: AnthropicBlock[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      const meta = readMeta(block);
      if (meta?.thought) {
        if (meta.kind === "redacted_thinking") {
          blocks.push({ type: "redacted_thinking", data: meta.data ?? "" });
        } else {
          blocks.push({ type: "thinking", thinking: block.text ?? "", signature: meta.signature ?? "" });
        }
        continue;
      }
      // Another provider's reasoning is not a Claude signature and is not the answer.
      if (isThoughtBlock(block)) continue;
      if (block.text) blocks.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "tool_use") {
      blocks.push({
        type: "tool_use",
        id: block.toolUseId ?? "",
        name: block.toolName ?? "",
        input: parseToolInput(block.toolInput),
      });
      continue;
    }
    if (block.type === "tool_result") {
      blocks.push({
        type: "tool_result",
        tool_use_id: block.toolUseId ?? "",
        content: block.toolResult ?? "",
        is_error: block.isError === true,
      });
    }
  }
  return blocks;
}

function parseToolInput(raw: string | undefined): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    throw new Error("anthropic: invalid tool input JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("anthropic: tool input must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function readMeta(block: Block): AnthropicMeta | undefined {
  if (typeof block.providerMeta !== "object" || block.providerMeta === null) return undefined;
  return (block.providerMeta as { anthropic?: AnthropicMeta }).anthropic;
}

function fromResult(raw: AnthropicResult): Response {
  const content: Block[] = [];
  let hasCall = false;
  for (const block of raw.content) {
    if (block.type === "tool_use") {
      hasCall = true;
      content.push({
        type: "tool_use",
        toolUseId: block.id,
        toolName: block.name,
        toolInput: JSON.stringify(block.input ?? {}),
      });
      continue;
    }
    if (block.type === "thinking") {
      content.push({
        type: "text",
        text: block.thinking,
        providerMeta: { anthropic: { thought: true, kind: "thinking", signature: block.signature } },
      });
      continue;
    }
    if (block.type === "redacted_thinking") {
      content.push({
        type: "text",
        text: "",
        providerMeta: { anthropic: { thought: true, kind: "redacted_thinking", data: block.data } },
      });
      continue;
    }
    if (block.type === "text" && block.text) {
      content.push({ type: "text", text: block.text });
    }
  }
  // A tool call wins even when stop_reason is end_turn. Anything else (max_tokens, refusal) is other.
  const stopReason = hasCall ? "tool_use" : raw.stopReason === "end_turn" ? "end_turn" : "other";
  return { content, stopReason, usage: toUsage(raw.usage) };
}

function toUsage(usage: AnthropicUsage | undefined): Usage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheCreationTokens: usage?.cacheCreationInputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadInputTokens ?? 0,
  };
}
