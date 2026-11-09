import { addUsage, emptyUsage, isThoughtBlock, type Message, type Response, type ToolDef, type Usage } from "../api/types.ts";
import { recordfc, recordp, recordpc } from "../debug/debug.ts";
import { marshalRequestPayload, marshalResponsePayload } from "./payloads.ts";
import type { Provider, SendContext, TokenReporter } from "./provider.ts";

export const OPENAI_DEFAULT_MODEL = "gpt-5";
const defaultMaxTokens = 8192;

/**
 * Standard tier, USD per million tokens.
 * Source: https://developers.openai.com/api/docs/pricing (read 2026-11-05).
 * gpt-5-codex is absent from that table; its row is from
 * https://developers.openai.com/api/docs/models/gpt-5-codex (shut down, Responses API only).
 * prompt_tokens includes cached tokens, so fresh input is the difference and
 * the cached slice is billed at the cache-read rate instead.
 */
const modelPricing: Record<string, { input: number; output: number; cacheRead: number }> = {
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5-codex": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
};

export interface OpenAIToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; toolCalls?: OpenAIToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface OpenAITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** The slice of chat.completions.create this adapter depends on. Tests fake this, not the SDK. */
export interface OpenAIRequest {
  model: string;
  maxCompletionTokens: number;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  signal?: AbortSignal;
}

export interface OpenAIUsage {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}

export interface OpenAIResult {
  /** True when the API returned no choices. */
  empty?: boolean;
  finishReason?: string;
  content?: string;
  toolCalls?: OpenAIToolCall[];
  usage?: OpenAIUsage;
}

export interface OpenAIClient {
  create(request: OpenAIRequest): Promise<OpenAIResult>;
}

type OpenAICtor = new (options: { apiKey?: string }) => {
  chat: {
    completions: {
      create(
        body: {
          model: string;
          max_completion_tokens: number;
          messages: Array<Record<string, unknown>>;
          tools?: Array<Record<string, unknown>>;
        },
        options: { signal?: AbortSignal },
      ): Promise<{
        choices?: Array<{
          finish_reason?: string | null;
          message?: {
            content?: string | null | Array<{ type?: string; text?: string }>;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      }>;
    };
  };
};

/**
 * Loaded only when a real call is made. A static import would force every test
 * that touches this module to have the openai package installed.
 */
async function createSdkClient(): Promise<OpenAIClient> {
  const specifier = "openai";
  const loaded = (await import(specifier)) as { default: OpenAICtor };
  const client = new loaded.default({ apiKey: process.env.OPENAI_API_KEY });
  return {
    async create(request) {
      const response = await client.chat.completions.create(
        {
          model: request.model,
          max_completion_tokens: request.maxCompletionTokens,
          messages: request.messages.map(toSdkMessage),
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools.map(toSdkTool) } : {}),
        },
        { signal: request.signal },
      );
      const choice = response.choices?.[0];
      const usage = {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens,
      };
      if (!choice) return { empty: true, usage };
      const message = choice.message;
      return {
        finishReason: choice.finish_reason ?? undefined,
        content: readContent(message?.content),
        toolCalls: (message?.tool_calls ?? []).map((call) => ({
          id: call.id ?? "",
          name: call.function?.name ?? "",
          arguments: call.function?.arguments ?? "",
        })),
        usage,
      };
    },
  };
}

function readContent(content: string | null | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.text)
    .map((part) => part.text ?? "")
    .join("\n");
}

function toSdkMessage(message: OpenAIMessage): Record<string, unknown> {
  if (message.role === "system" || message.role === "user") {
    return { role: message.role, content: message.content };
  }
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  return {
    role: "assistant",
    ...(message.content !== undefined ? { content: message.content } : {}),
    ...(message.toolCalls && message.toolCalls.length > 0
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      : {}),
  };
}

function toSdkTool(tool: OpenAITool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export class OpenAIProvider implements Provider, TokenReporter {
  private modelName: string;
  private readonly system: string;
  private readonly client?: OpenAIClient;
  private readonly maxTokens: number;
  private total: Usage = emptyUsage();
  private clientPromise: Promise<OpenAIClient> | null = null;

  constructor(model: string, system: string, client?: OpenAIClient, maxTokens = defaultMaxTokens) {
    // Parameter properties are rejected by Node's type stripper, so fields are assigned here.
    this.modelName = model === "" ? OPENAI_DEFAULT_MODEL : model;
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
    const fresh = Math.max(0, this.total.inputTokens - this.total.cacheReadTokens);
    return (fresh * rates.input + this.total.outputTokens * rates.output + this.total.cacheReadTokens * rates.cacheRead) / 1_000_000;
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
      `→ openai.Send model=${model} msgs=${messages.length} tools=${tools.length}`,
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
        `← openai.Send (${elapsed}ms in=${response.usage.inputTokens} out=${response.usage.outputTokens} cache=${response.usage.cacheReadTokens} stop=${response.stopReason})`,
        marshalResponsePayload(response, elapsed),
      );
      return response;
    } catch (err) {
      const elapsed = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      recordfc(reqId, "provider", "error", "← openai.Send error (%sms): %s", elapsed, message);
      throw err;
    }
  }

  private sdk(): Promise<OpenAIClient> {
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
): OpenAIRequest {
  return {
    model,
    maxCompletionTokens: maxTokens,
    messages: toMessages(system, messages),
    tools: toTools(tools),
    signal,
  };
}

function toTools(tools: ToolDef[]): OpenAITool[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((tool) => {
    const parameters: Record<string, unknown> = {
      type: "object",
      properties: tool.inputSchema,
    };
    if (tool.required.length > 0) parameters.required = tool.required;
    return { name: tool.name, description: tool.description, parameters };
  });
}

function toMessages(system: string, messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (system !== "") out.push({ role: "system", content: system });
  for (const message of messages) {
    if (message.role === "user") {
      const texts: string[] = [];
      const toolMessages: OpenAIMessage[] = [];
      for (const block of message.content) {
        if (block.type === "text" && block.text && !isThoughtBlock(block)) texts.push(block.text);
        if (block.type === "tool_result") {
          toolMessages.push({ role: "tool", toolCallId: block.toolUseId ?? "", content: block.toolResult ?? "" });
        }
      }
      if (texts.length > 0) out.push({ role: "user", content: texts.join("\n") });
      out.push(...toolMessages);
      continue;
    }
    const texts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];
    for (const block of message.content) {
      if (block.type === "text" && block.text && !isThoughtBlock(block)) texts.push(block.text);
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.toolUseId ?? "",
          name: block.toolName ?? "",
          arguments: block.toolInput ?? "",
        });
      }
    }
    if (texts.length === 0 && toolCalls.length === 0) continue;
    out.push({
      role: "assistant",
      ...(texts.length > 0 ? { content: texts.join("\n") } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }
  return out;
}

function fromResult(raw: OpenAIResult): Response {
  if (raw.empty) {
    return { content: [], stopReason: "other", usage: toUsage(raw.usage) };
  }
  const content: Block[] = [];
  if (raw.content) content.push({ type: "text", text: raw.content });
  for (const call of raw.toolCalls ?? []) {
    content.push({
      type: "tool_use",
      toolUseId: call.id,
      toolName: call.name,
      toolInput: call.arguments,
    });
  }
  const hasCall = (raw.toolCalls ?? []).length > 0;
  const stopReason = hasCall ? "tool_use" : raw.finishReason === "stop" ? "end_turn" : "other";
  return { content, stopReason, usage: toUsage(raw.usage) };
}

function toUsage(usage: OpenAIUsage | undefined): Usage {
  return {
    inputTokens: usage?.promptTokens ?? 0,
    outputTokens: usage?.completionTokens ?? 0,
    cacheCreationTokens: 0,
    cacheReadTokens: usage?.cachedTokens ?? 0,
  };
}
