import { appendFileSync } from "node:fs";

import { renderTranscript, type Message } from "../api/types.ts";
import { consoleSink, type LineSink } from "../output.ts";
import type { CompactionStrategy } from "./strategy.ts";

/**
 * Appends a before/after transcript when the inner strategy actually shortens the history.
 * A failed write is reported and swallowed: the compaction itself already happened.
 */
export class LoggingStrategy implements CompactionStrategy {
  readonly inner: CompactionStrategy;
  readonly filePath: string;
  readonly write: LineSink;

  constructor(inner: CompactionStrategy, filePath: string, write: LineSink = consoleSink) {
    this.inner = inner;
    this.filePath = filePath;
    this.write = write;
  }

  async compact(messages: Message[]): Promise<Message[]> {
    const after = await this.inner.compact(messages);
    if (after.length === messages.length || this.filePath === "") return after;
    try {
      appendFileSync(this.filePath, renderEvent(messages, after), "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.write(`compaction log write failed: ${message}`);
    }
    return after;
  }
}

export function withLogging(inner: CompactionStrategy, filePath: string, write?: LineSink): LoggingStrategy {
  return new LoggingStrategy(inner, filePath, write);
}

function renderEvent(before: Message[], after: Message[]): string {
  return [
    "=========================",
    `[${new Date().toISOString()}] compaction event`,
    `BEFORE (${before.length} messages):`,
    renderTranscript(before),
    "---",
    `AFTER (${after.length} messages):`,
    renderTranscript(after),
    "",
  ].join("\n");
}
