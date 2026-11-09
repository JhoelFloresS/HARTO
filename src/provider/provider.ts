import type { Message, Response, ToolDef, Usage } from "../api/types.ts";

export interface SendContext {
  signal?: AbortSignal;
  /** This call's system prompt. Absent means the system the provider was built with. */
  system?: string;
}

export interface Provider {
  send(messages: Message[], tools: ToolDef[], ctx?: SendContext): Promise<Response>;
  model(): string;
  setModel(name: string): void;
}

export interface TokenReporter {
  totalUsage(): Usage;
  estimatedCostUsd(): number;
}
