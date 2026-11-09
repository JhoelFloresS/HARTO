const maxBytes = 100 * 1024;

/** Cap tool output before it is fed back into the model context. */
export function capOutput(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let sliced = bytes.subarray(0, maxBytes).toString("utf8");
  if (sliced.endsWith("\uFFFD")) sliced = sliced.slice(0, -1);
  return `${sliced}\n[truncated]`;
}
