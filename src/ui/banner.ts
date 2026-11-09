/** Violet is the interface color. The diff keeps its own green, red, and cyan. */
export const violet = "#C084FC";
export const violetSoft = "#A78BFA";

export const subtitle = "by topicos students";

const hint = "type a message · /help for commands · ctrl-c cancels the turn · /exit to quit";

const letters: string[][] = [
  ["██╗  ██╗", "██║  ██║", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
  ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
  [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
];

const wordmarkLines = buildWordmark(letters);
const wordmark = new Set(wordmarkLines);

/** Plain lines. The TUI colors them; the REPL uses {@link bannerAnsi}. */
export function bannerText(project = ""): string {
  return bannerParts(project).join("\n");
}

/** Same banner, with violet ANSI, for a terminal that is not running Ink. */
export function bannerAnsi(project = ""): string {
  return bannerParts(project)
    .map((line) => {
      if (wordmark.has(line) || (project !== "" && line === project)) return ansi(line, violet, true);
      if (line === centeredSubtitle()) return ansi(line, violetSoft, false);
      if (line === hint) return ansi(line, violetSoft, false, true);
      return line;
    })
    .join("\n");
}

export function isWordmark(line: string): boolean {
  return wordmark.has(line);
}

export function isSubtitle(line: string): boolean {
  return line === centeredSubtitle();
}

function bannerParts(project: string): string[] {
  const lines = [...wordmarkLines, centeredSubtitle()];
  if (project !== "") lines.push(project);
  lines.push(hint, "");
  return lines;
}

function centeredSubtitle(): string {
  const width = wordmarkLines[0]?.length ?? subtitle.length;
  const pad = Math.max(0, Math.floor((width - subtitle.length) / 2));
  return `${" ".repeat(pad)}${subtitle}`;
}

function buildWordmark(rows: string[][]): string[] {
  const padded = rows.map((letter) => {
    const width = Math.max(0, ...letter.map((row) => row.length));
    return letter.map((row) => row.padEnd(width));
  });
  const height = padded[0]?.length ?? 0;
  const lines: string[] = [];
  for (let row = 0; row < height; row++) {
    lines.push(padded.map((letter) => letter[row] ?? "").join(" "));
  }
  return lines;
}

function ansi(text: string, hex: string, bold: boolean, dim = false): string {
  const [red, green, blue] = rgb(hex);
  const weight = `${bold ? "1;" : ""}${dim ? "2;" : ""}`;
  return `\x1b[${weight}38;2;${red};${green};${blue}m${text}\x1b[0m`;
}

function rgb(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}
