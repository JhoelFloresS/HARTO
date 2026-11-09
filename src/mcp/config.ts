import { readFile } from "node:fs/promises";

export interface ServerConfig {
  name: string;
  transport: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

export interface McpConfig {
  servers: ServerConfig[];
}

/** Missing file is opt-in silence. Invalid JSON throws so the caller can warn and skip every server. */
export async function loadConfig(path: string): Promise<McpConfig | null> {
  let data: string;
  try {
    data = await readFile(path, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(data) as { servers?: unknown };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.servers)) {
      throw new Error("expected a servers array");
    }
    return { servers: parsed.servers as ServerConfig[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`parse mcp config ${path}: ${message}`);
  }
}

/**
 * ${VAR} in args, the URL, and header values. Header names stay literal.
 * The command is expanded too: the reference does, and a command is the same kind of string as an arg.
 * An unset variable becomes an empty string.
 */
export function expandServer(server: ServerConfig): ServerConfig {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(server.headers ?? {})) headers[key] = expand(value);
  return {
    name: server.name,
    transport: server.transport,
    command: server.command === undefined ? undefined : expand(server.command),
    args: server.args?.map(expand),
    url: server.url === undefined ? undefined : expand(server.url),
    headers,
  };
}

export function expand(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => process.env[name] ?? "");
}

function isMissing(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}
