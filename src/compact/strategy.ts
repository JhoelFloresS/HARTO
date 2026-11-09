import { hasToolResult, type Message } from "../api/types.ts";

export interface CompactionStrategy {
  compact(messages: Message[]): Promise<Message[]>;
}

/** Walk back to a user message that is not a tool result, so a tool_use stays with its result. */
export function safeSplitPoint(messages: Message[], desired: number): number {
  if (desired <= 0) return 0;
  if (desired >= messages.length) return messages.length;
  for (let i = desired; i > 0; i--) {
    const message = messages[i];
    if (message.role === "user" && !hasToolResult(message)) {
      return i;
    }
  }
  return 0;
}

export class NoCompaction implements CompactionStrategy {
  async compact(messages: Message[]): Promise<Message[]> {
    return messages;
  }
}
