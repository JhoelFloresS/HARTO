import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Last lines the user sent, one per line, in their home directory. */
export function historyPath(home = homedir()): string {
  return join(home, ".harto_history");
}

export function loadHistory(path: string): string[] {
  try {
    const lines = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line !== "");
    return lines.slice(-500);
  } catch {
    return [];
  }
}

export function appendHistory(path: string, line: string): void {
  if (!path || line === "") return;
  try {
    appendFileSync(path, `${line}\n`, "utf8");
  } catch {
    // A missing home directory should not stop the turn.
  }
}
