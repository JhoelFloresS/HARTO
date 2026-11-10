import { addUsage, emptyUsage, type Block, type Message, type Response, type ToolDef, type Usage } from "../api/types.ts";
import { recordfc, recordp, recordpc } from "../debug/debug.ts";
import { marshalRequestPayload, marshalResponsePayload } from "./payloads.ts";
import type { Provider, SendContext, TokenReporter } from "./provider.ts";

export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";
const defaultMaxTokens = 8192;

/**
 * Standard paid-tier text rates, USD per million tokens.
 * Source: https://ai.google.dev/gemini-api/docs/pricing (read 2026-11-05).
 * gemini-3.8-flash and gemini-3.6-flash are on introductory rates through
 * 2026-12-31; from 2027-01-01 those rows become 1.50 / 7.50 / 0.15.
 */
const modelPricing: Record<string, { input: number; output: number; cacheRead: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cacheRead: 0.075 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75, cacheRead: 0.075 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03 },
};

export interface GeminiFunctionCall {
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
}

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: {
    name?: string;
    id?: string;
    response?: Record<string, unknown>;
  };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** The slice of generateContent this adapter depends on. Tests fake this, not the SDK. */
export interface GeminiRequest {
  model: string;
  systemInstruction?: string;
  contents: GeminiContent[];
  functionDeclarations?: GeminiDeclaration[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

export interface GeminiResult {
  parts: GeminiPart[];
  finishReason?: string;
  usage?: GeminiUsage;
}

export interface GeminiClient {
  generateContent(request: GeminiRequest): Promise<GeminiResult>;
  stream?(request: GeminiRequest, onText: (delta: string) => void): Promise<GeminiResult>;
}

type GoogleGenAICtor = new (options: { apiKey?: string }) => {
  models: {
    generateContent(params: {
      model: string;
      contents: GeminiContent[];
      config?: {
        systemInstruction?: string;
        maxOutputTokens?: number;
        abortSignal?: AbortSignal;
        tools?: Array<{
          functionDeclarations: Array<{
            name: string;
            description?: string;
            parametersJsonSchema?: Record<string, unknown>;
          }>;
        }>;
      };
    }): Promise<{
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: GeminiPart[] };
      }>;
      usageMetadata?: GeminiUsage;
    }>;
  };
};

/**
 * Loaded only when a real call is made. A static import would force every test
 * that touches this module to have @google/genai installed.
 */
async function createSdkClient(): Promise<GeminiClient> {
  const specifier = "@google/genai";
  const loaded = (await import(specifier)) as { GoogleGenAI: GoogleGenAICtor };
  const ai = new loaded.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
  });
  return {
    async generateContent(request) {
      const response = await ai.models.generateContent({
        model: request.model,
        contents: request.contents,
        config: {
          ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
          maxOutputTokens: request.maxOutputTokens,
          abortSignal: request.signal,
          ...(request.functionDeclarations && request.functionDeclarations.length > 0
            ? {
                tools: [
                  {
                    functionDeclarations: request.functionDeclarations.map((fn) => ({
                      name: fn.name,
                      description: fn.description,
                      // `parameters` on the SDK expects the old uppercase schema.
                      // parametersJsonSchema takes the JSON Schema we already store.
                      parametersJsonSchema: fn.parameters,
                    })),
                  },
                ],
              }
            : {}),
        },
      });
      const candidate = response.candidates?.[0];
      return {
        parts: candidate?.content?.parts ?? [],
        finishReason: candidate?.finishReason,
        usage: response.usageMetadata,
      };
    },
    async stream(request, onText) {
      const live = ai as unknown as {
        models: {
          generateContentStream(params: Record<string, unknown>): Promise<AsyncIterable<GeminiStreamChunk>> | AsyncIterable<GeminiStreamChunk>;
        };
      };
      const events = await Promise.resolve(
        live.models.generateContentStream({
          model: request.model,
          contents: request.contents,
          config: {
            ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
            maxOutputTokens: request.maxOutputTokens,
            abortSignal: request.signal,
            ...(request.functionDeclarations && request.functionDeclarations.length > 0
              ? {
                  tools: [
                    {
                      functionDeclarations: request.functionDeclarations.map((fn) => ({
                        name: fn.name,
                        description: fn.description,
                        parametersJsonSchema: fn.parameters,
                      })),
                    },
                  ],
                }
              : {}),
          },
        }),
      );
      return collectGemini(events, onText);
    },
  };
}

interface GeminiStreamChunk {
  candidates?: Array<{ finishReason?: string; content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: GeminiUsage;
}

async function collectGemini(events: AsyncIterable<GeminiStreamChunk>, onText: (delta: string) => void): Promise<GeminiResult> {
  const parts: GeminiPart[] = [];
  let finishReason: string | undefined;
  let usage: GeminiUsage | undefined;
  for await (const chunk of events) {
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text && !part.thought) onText(part.text);
      parts.push(part);
    }
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (chunk.usageMetadata) usage = chunk.usageMetadata;
  }
  return { parts, finishReason, usage };
}

export class GeminiProvider implements Provider, TokenReporter {
  private modelName: string;
  private readonly system: string;
  private readonly client?: GeminiClient;
  private readonly maxTokens: number;
  private total: Usage = emptyUsage();
  private clientPromise: Promise<GeminiClient> | null = null;

  constructor(model: string, system: string, client?: GeminiClient, maxTokens = defaultMaxTokens) {
    // Parameter properties are rejected by Node's type stripper, so fields are assigned here.
    this.modelName = model === "" ? GEMINI_DEFAULT_MODEL : model;
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

  /**
   * promptTokenCount includes cached tokens, so fresh input is the difference.
   * Cached tokens are billed at the cache-read rate instead.
   */
  estimatedCostUsd(): number {
    const rates = modelPricing[this.modelName];
    if (!rates) return -1;
    const fresh = Math.max(0, this.total.inputTokens - this.total.cacheReadTokens);
    return (
      (fresh * rates.input + this.total.outputTokens * rates.output + this.total.cacheReadTokens * rates.cacheRead) /
      1_000_000
    );
  }

  async send(messages: Message[], tools: ToolDef[], ctx: SendContext = {}): Promise<Response> {
    const model = this.modelName;
    const system = ctx.system ?? this.system;
    const request = toRequest(model, system, this.maxTokens, messages, tools, ctx.signal);
    const reqId = recordp(
      "provider",
      "info",
      `→ gemini.Send model=${model} msgs=${messages.length} tools=${tools.length}`,
      marshalRequestPayload(model, system, this.maxTokens, messages, tools),
    );
    const start = Date.now();
    try {
      const client = this.client ?? (await this.sdk());
      const raw = ctx.onText && client.stream ? await client.stream(request, ctx.onText) : await client.generateContent(request);
      const response = fromResult(raw);
      this.total = addUsage(this.total, response.usage);
      const elapsed = Date.now() - start;
      recordpc(
        reqId,
        "provider",
        "info",
        `← gemini.Send (${elapsed}ms in=${response.usage.inputTokens} out=${response.usage.outputTokens} cache=${response.usage.cacheReadTokens} stop=${response.stopReason})`,
        marshalResponsePayload(response, elapsed),
      );
      return response;
    } catch (err) {
      const elapsed = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      recordfc(reqId, "provider", "error", "← gemini.Send error (%sms): %s", elapsed, message);
      throw err;
    }
  }

  private sdk(): Promise<GeminiClient> {
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
): GeminiRequest {
  return {
    model,
    ...(system === "" ? {} : { systemInstruction: system }),
    contents: toContents(messages),
    functionDeclarations: toDeclarations(tools),
    maxOutputTokens: maxTokens,
    signal,
  };
}

function toDeclarations(tools: ToolDef[]): GeminiDeclaration[] | undefined {
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

function toContents(messages: Message[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";
    const parts = message.content.flatMap((block) => blockToParts(block, messages));
    if (parts.length === 0) continue;
    const last = contents.at(-1);
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  return contents;
}

function blockToParts(block: Block, messages: Message[]): GeminiPart[] {
  if (block.type === "text") {
    if (!block.text) return [];
    return [{ text: block.text, ...partMeta(block) }];
  }
  if (block.type === "tool_use") {
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(block.toolInput ?? "{}") as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("tool input must be a JSON object");
      }
      args = parsed as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`gemini: tool input for ${block.toolName ?? "(unknown)"} is not valid JSON (${message})`);
    }
    return [
      {
        ...partMeta(block),
        functionCall: {
          name: block.toolName,
          args,
          ...(block.toolUseId ? { id: block.toolUseId } : {}),
        },
      },
    ];
  }
  const name = findToolName(messages, block.toolUseId);
  if (!name) {
    throw new Error(`gemini: no matching tool_use for id ${block.toolUseId ?? "(missing)"}`);
  }
  return [
    {
      ...partMeta(block),
      functionResponse: {
        name,
        ...(block.toolUseId ? { id: block.toolUseId } : {}),
        response: block.isError ? { error: block.toolResult ?? "" } : { output: block.toolResult ?? "" },
      },
    },
  ];
}

function findToolName(messages: Message[], id: string | undefined): string | undefined {
  if (!id) return undefined;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use" && block.toolUseId === id && block.toolName) return block.toolName;
    }
  }
  return undefined;
}

function partMeta(block: Block): { thought?: boolean; thoughtSignature?: string } {
  if (typeof block.providerMeta !== "object" || block.providerMeta === null) return {};
  const gemini = (block.providerMeta as { gemini?: { thought?: boolean; thoughtSignature?: string } }).gemini;
  if (!gemini) return {};
  return {
    ...(gemini.thought ? { thought: true } : {}),
    ...(gemini.thoughtSignature ? { thoughtSignature: gemini.thoughtSignature } : {}),
  };
}

function fromResult(raw: GeminiResult): Response {
  const parts = raw.parts ?? [];
  const hasCall = parts.some((part) => part.functionCall);
  const finish = raw.finishReason ?? "";
  // A function call wins even when finishReason is STOP. Anything that is not
  // a clean STOP (safety blocks, max tokens, a missing candidate) is "other".
  const stopReason = hasCall ? "tool_use" : finish === "STOP" ? "end_turn" : "other";

  const content: Block[] = [];
  let callIndex = 0;
  for (const part of parts) {
    const meta = blockMeta(part);
    if (part.functionCall) {
      const id = part.functionCall.id ? part.functionCall.id : `call_${callIndex}`;
      callIndex += 1;
      content.push({
        type: "tool_use",
        toolUseId: id,
        toolName: part.functionCall.name ?? "",
        toolInput: JSON.stringify(part.functionCall.args ?? {}),
        ...(meta ? { providerMeta: meta } : {}),
      });
      continue;
    }
    if (part.text) {
      content.push({
        type: "text",
        text: part.text,
        ...(meta ? { providerMeta: meta } : {}),
      });
    }
  }

  if (stopReason === "other" && !content.some((block) => block.type === "text")) {
    content.push({ type: "text", text: `gemini: ${finish === "" ? "NO_CANDIDATE" : finish}` });
  }

  return { content, stopReason, usage: toUsage(raw.usage) };
}

function blockMeta(part: GeminiPart): { gemini: { thought?: boolean; thoughtSignature?: string } } | undefined {
  if (!part.thought && !part.thoughtSignature) return undefined;
  return {
    gemini: {
      ...(part.thought ? { thought: true } : {}),
      ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
    },
  };
}

/**
 * thoughtsTokenCount is a separate field from candidatesTokenCount
 * (https://ai.google.dev/api/generate-content#UsageMetadata). The pricing page
 * bills thinking tokens as output, so they are added here and not dropped.
 */
function toUsage(usage: GeminiUsage | undefined): Usage {
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cacheCreationTokens: 0,
    cacheReadTokens: usage?.cachedContentTokenCount ?? 0,
  };
}
