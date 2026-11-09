/** One line (or a chunk that already contains newlines) for the UI scrollback. */
export type LineSink = (line: string) => void;

export function consoleSink(line: string): void {
  process.stdout.write(line.endsWith("\n") ? line : `${line}\n`);
}

export function captureSink(): { sink: LineSink; text: () => string } {
  const lines: string[] = [];
  return {
    sink(line: string) {
      lines.push(line.endsWith("\n") ? line : `${line}\n`);
    },
    text() {
      return lines.join("");
    },
  };
}
