import { addUsage, emptyUsage, type Message, type Response, type ToolDef, type Usage } from "../api/types.ts";
import { recordfc, recordp, recordpc } from "../debug/debug.ts";
import { marshalRequestPayload, marshalResponsePayload } from "./payloads.ts";
import { completeChat, createChatClient, type OpenAIClient } from "./openai.ts";
import type { Provider, SendContext, TokenReporter } from "./provider.ts";

export const OPENROUTER_DEFAULT_MODEL = "openai/gpt-5-mini";
const defaultMaxTokens = 8192;
const baseURL = "https://openrouter.ai/api/v1";

/**
 * Chat Completions through OpenRouter. The OpenAI package is loaded by openai.ts.
 * Model ids are OpenRouter slugs (`vendor/model`). Any id is accepted; the API validates it.
 * Rates are not tabulated: estimated cost stays -1.
 */
export class OpenRouterProvider implements Provider, TokenReporter {
  private modelName: string;
  private readonly system: string;
  private readonly client?: OpenAIClient;
  private readonly maxTokens: number;
  private total: Usage = emptyUsage();
  private clientPromise: Promise<OpenAIClient> | null = null;

  constructor(model: string, system: string, client?: OpenAIClient, maxTokens = defaultMaxTokens) {
    this.modelName = model === "" ? OPENROUTER_DEFAULT_MODEL : model;
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
    return -1;
  }

  async send(messages: Message[], tools: ToolDef[], ctx: SendContext = {}): Promise<Response> {
    const model = this.modelName;
    const system = ctx.system ?? this.system;
    const reqId = recordp(
      "provider",
      "info",
      `→ openrouter.Send model=${model} msgs=${messages.length} tools=${tools.length}`,
      marshalRequestPayload(model, system, this.maxTokens, messages, tools),
    );
    const start = Date.now();
    try {
      const client = this.client ?? (await this.sdk());
      const response = await completeChat(client, model, system, this.maxTokens, messages, tools, ctx);
      this.total = addUsage(this.total, response.usage);
      const elapsed = Date.now() - start;
      recordpc(
        reqId,
        "provider",
        "info",
        `← openrouter.Send (${elapsed}ms in=${response.usage.inputTokens} out=${response.usage.outputTokens} cache=${response.usage.cacheReadTokens} stop=${response.stopReason})`,
        marshalResponsePayload(response, elapsed),
      );
      return response;
    } catch (err) {
      const elapsed = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      recordfc(reqId, "provider", "error", "← openrouter.Send error (%sms): %s", elapsed, message);
      throw err;
    }
  }

  private sdk(): Promise<OpenAIClient> {
    this.clientPromise ??= createChatClient({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL,
      defaultHeaders: { "X-Title": "harto" },
    });
    return this.clientPromise;
  }
}
