import { isThoughtBlock, renderTranscript, type Message } from "../api/types.ts";
import type { LineSink } from "../output.ts";
import { consoleSink } from "../output.ts";
import type { Provider } from "../provider/provider.ts";
import { safeSplitPoint, type CompactionStrategy } from "./strategy.ts";

const defaultInstructions =
  "Summarize the following conversation concisely. " +
  "Preserve facts, decisions, file paths, code identifiers, and anything else " +
  "needed to continue the conversation. Output the summary directly with no preamble.";

/**
 * Replaces the old prefix with one user message once the history reaches the threshold.
 * The summary call uses the same provider, so its tokens land in that provider's total.
 */
export class Summarize implements CompactionStrategy {
  readonly provider: Provider;
  readonly threshold: number;
  readonly keepRecent: number;
  readonly instructions: string;
  readonly write: LineSink;

  constructor(
    provider: Provider,
    threshold: number,
    keepRecent: number,
    write: LineSink = consoleSink,
    instructions = "",
  ) {
    this.provider = provider;
    this.threshold = threshold;
    this.keepRecent = keepRecent;
    this.write = write;
    this.instructions = instructions;
  }

  async compact(messages: Message[]): Promise<Message[]> {
    if (messages.length < this.threshold) return messages;
    const split = safeSplitPoint(messages, messages.length - this.keepRecent);
    if (split === 0) return messages;

    const old = messages.slice(0, split);
    const recent = messages.slice(split);
    const instructions = this.instructions === "" ? defaultInstructions : this.instructions;
    let response;
    try {
      response = await this.provider.send(
        [{ role: "user", content: [{ type: "text", text: `${instructions}\n\n${renderTranscript(old)}` }] }],
        [],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`summarize: ${message}`);
    }

    const summary = response.content.find((block) => block.type === "text" && block.text && !isThoughtBlock(block))?.text;
    if (!summary) throw new Error("summarize: empty response");

    this.write(`[compacted ${old.length} messages → summary]`);
    const replacement: Message = {
      role: "user",
      content: [{ type: "text", text: `[earlier conversation summary]\n${summary}` }],
    };
    return [replacement, ...recent];
  }
}
