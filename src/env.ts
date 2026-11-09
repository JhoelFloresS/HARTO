import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Development convenience. The shell still wins: a variable already set is left alone.
 * Accepts dotenv lines and the `set` / `export` form, because a Windows .env is often written that way.
 */
export function loadEnvFile(file = join(process.cwd(), ".env")): void {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.replace(/^(?:set|export)\s+/i, "");
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[\w.]+$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
