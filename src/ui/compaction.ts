import { renderTranscript, type Message } from "../api/types.ts";
import type { LineSink } from "../output.ts";

/** Before/after transcript for /verbose. Level A prints it as text; the TUI can reuse the same words. */
export function printCompaction(before: Message[], after: Message[], write: LineSink): void {
  write("─── compaction ───");
  write(`BEFORE (${before.length} messages):\n${renderTranscript(before)}`);
  write("─── after ───");
  write(`AFTER (${after.length} messages):\n${renderTranscript(after)}`);
  write("──────────────");
}
