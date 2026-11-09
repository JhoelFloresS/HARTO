import type { Message } from "../api/types.ts";
import { safeSplitPoint, type CompactionStrategy } from "./strategy.ts";

/** Drops messages older than the trailing window, on a tool-call boundary. */
export class SlidingWindow implements CompactionStrategy {
  readonly keepLast: number;

  constructor(keepLast: number) {
    this.keepLast = keepLast;
  }

  async compact(messages: Message[]): Promise<Message[]> {
    if (messages.length <= this.keepLast) return messages;
    const split = safeSplitPoint(messages, messages.length - this.keepLast);
    return messages.slice(split);
  }
}
