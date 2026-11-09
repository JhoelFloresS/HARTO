import type { Message, Response, ToolDef } from "../api/types.ts";

/** Pretty JSON of the domain request for /debug. Schemas are omitted on purpose. */
export function marshalRequestPayload(
  model: string,
  system: string,
  maxTokens: number,
  messages: Message[],
  tools: ToolDef[],
): string {
  const payload = {
    model,
    max_tokens: maxTokens,
    system,
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
    messages,
  };
  return stringify(payload);
}

export function marshalResponsePayload(response: Response, elapsedMs: number): string {
  return stringify({
    elapsed: `${elapsedMs}ms`,
    stop_reason: response.stopReason,
    usage: response.usage,
    content: response.content,
  });
}

function stringify(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `marshal error: ${message}`;
  }
}
