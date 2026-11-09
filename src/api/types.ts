// Provider-agnostic message types. Adapters translate to and from these;
// the loop, tools, and compaction speak only this shape.

export type Role = "user" | "assistant";

export type BlockType = "text" | "tool_use" | "tool_result";

export interface Block {
  type: BlockType;
  text?: string;
  toolUseId?: string;
  toolName?: string;
  /** Raw JSON. Adapters parse it only when their wire format requires an object. */
  toolInput?: string;
  toolResult?: string;
  isError?: boolean;
  /**
   * Opaque blob the originating provider round-trips. The loop copies it
   * unchanged and only inspects the thought flag (see isThoughtBlock).
   */
  providerMeta?: unknown;
}

export interface Message {
  role: Role;
  content: Block[];
}

export function hasToolResult(message: Message): boolean {
  return message.content.some((block) => block.type === "tool_result");
}

/** True when the block is model reasoning that must be replayed but not shown. */
export function isThoughtBlock(block: Block): boolean {
  if (typeof block.providerMeta !== "object" || block.providerMeta === null) {
    return false;
  }
  const meta = block.providerMeta as {
    gemini?: { thought?: boolean };
    anthropic?: { thought?: boolean };
  };
  return meta.gemini?.thought === true || meta.anthropic?.thought === true;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Inner JSON Schema `properties` map, not the enclosing object schema. */
  inputSchema: Record<string, unknown>;
  required: string[];
}

export type StopReason = "end_turn" | "tool_use" | "other";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
}

export function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  };
}

export interface Response {
  content: Block[];
  stopReason: StopReason;
  usage: Usage;
}

/** Plain transcript for summarization prompts and compaction logs. */
export function renderTranscript(messages: Message[]): string {
  let out = "";
  for (const message of messages) {
    out += `${message.role}: `;
    for (const block of message.content) {
      switch (block.type) {
        case "text":
          out += block.text ?? "";
          break;
        case "tool_use":
          out += `[called ${block.toolName ?? ""} with ${block.toolInput ?? ""}]`;
          break;
        case "tool_result":
          out += `[tool result: ${block.toolResult ?? ""}]`;
          break;
      }
      out += "\n";
    }
  }
  return out;
}
