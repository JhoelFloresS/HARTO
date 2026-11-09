import { isThoughtBlock, renderTranscript, type Message } from "../api/types.ts";
import type { Provider } from "../provider/provider.ts";

const maxTranscript = 50_000;

const instruction = `You are summarizing a coding-agent session for persistent memory used by future sessions.

Output format, exactly:

<one paragraph: what was worked on, what was decided, what is still open>

TAGS: tag1, tag2, tag3

Use 3–5 single-word lowercase tags. Be concrete (file names, packages, concepts).

Transcript follows:

`;

export interface SessionSummary {
  summary: string;
  tags: string[];
}

/** Last `TAGS:` wins. A reply without that marker is still a summary, never an error. */
export function parseSummaryAndTags(text: string): SessionSummary {
  const marker = "TAGS:";
  const at = text.lastIndexOf(marker);
  if (at < 0) return { summary: text.trim(), tags: [] };
  const summary = text.slice(0, at).trim();
  const tags = text
    .slice(at + marker.length)
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag !== "");
  return { summary, tags };
}

/**
 * Best-effort. A failed send still returns text so close can flush the remember draft.
 * Thought blocks are not the paragraph the next session should read.
 */
export async function summarizeSession(provider: Provider, history: Message[]): Promise<SessionSummary> {
  let transcript = renderTranscript(history);
  if (transcript.length > maxTranscript) {
    transcript = transcript.slice(0, maxTranscript) + "\n[...truncated...]";
  }
  try {
    const response = await provider.send(
      [{ role: "user", content: [{ type: "text", text: instruction + transcript }] }],
      [],
    );
    const text = response.content
      .filter((block) => block.type === "text" && block.text && !isThoughtBlock(block))
      .map((block) => block.text ?? "")
      .join("");
    return parseSummaryAndTags(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { summary: `(summarization failed: ${message})`, tags: [] };
  }
}
