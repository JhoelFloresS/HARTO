import type { ToolDef } from "../api/types.ts";
import type { Registry, Tool, ToolContext, ToolResult } from "../tool/registry.ts";
import { expandServer, type McpConfig, type ServerConfig } from "./config.ts";
import { connectServer } from "./client.ts";
import type { McpProgress } from "./progress.ts";
import type { McpContent, McpSession } from "./session.ts";

export type Dial = (server: ServerConfig, signal?: AbortSignal) => Promise<McpSession>;

/** One remote tool, registered under `<server>_<remote>` and called by the remote name. */
export class MCPTool implements Tool {
  mcp = true;
  session: McpSession;
  remoteName: string;
  private def: ToolDef;

  constructor(session: McpSession, remoteName: string, def: ToolDef) {
    this.session = session;
    this.remoteName = remoteName;
    this.def = def;
  }

  definition(): ToolDef {
    return this.def;
  }

  async execute(input: string, ctx: ToolContext = {}): Promise<ToolResult> {
    let args: Record<string, unknown> = {};
    if (input !== "") {
      try {
        const parsed = JSON.parse(input) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { result: "invalid tool input: expected an object", isError: true };
        }
        args = parsed as Record<string, unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { result: `invalid tool input: ${message}`, isError: true };
      }
    }
    try {
      const result = await this.session.callTool(this.remoteName, args, ctx.signal);
      return { result: flattenContent(result.content), isError: result.isError };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: message, isError: true };
    }
  }
}

export function flattenContent(blocks: McpContent[]): string {
  return blocks
    .map((block) => (block.type === "text" ? (block.text ?? "") : `[non-text content block: ${block.type ?? "unknown"}]`))
    .join("\n");
}

/** A non-object schema is skipped. Missing `properties` is an empty map, not a failure. */
export function splitSchema(schema: unknown): { properties: Record<string, unknown>; required: string[] } | null {
  if (schema == null) return { properties: {}, required: [] };
  if (typeof schema !== "object" || Array.isArray(schema)) return null;
  const record = schema as Record<string, unknown>;
  let properties: Record<string, unknown> = {};
  if (record.properties !== undefined) {
    if (typeof record.properties !== "object" || record.properties === null || Array.isArray(record.properties)) return null;
    properties = record.properties as Record<string, unknown>;
  }
  const required: string[] = [];
  if (Array.isArray(record.required)) {
    for (const item of record.required) {
      if (typeof item === "string") required.push(item);
    }
  }
  return { properties, required };
}

/**
 * Connects every server and registers the tools it lists. One failure is a
 * stderr line and a skipped server; the rest still register. `config === null`
 * (no mcp.json) does nothing.
 */
export async function registerMcp(
  config: McpConfig | null,
  registry: Registry,
  options: {
    signal?: AbortSignal;
    progress?: (event: McpProgress) => void;
    dial?: Dial;
    stderr?: (line: string) => void;
  } = {},
): Promise<McpSession[]> {
  if (!config) return [];
  const dial = options.dial ?? connectServer;
  const warn = options.stderr ?? ((line: string) => process.stderr.write(line));
  const total = config.servers.length;
  const opened: McpSession[] = [];
  options.progress?.({ phase: "begin", total });
  try {
    for (const server of config.servers) {
      if (options.signal?.aborted) break;
      const name = typeof server?.name === "string" ? server.name : "";
      options.progress?.({ phase: "connecting", server: name, total });
      let session: McpSession;
      try {
        session = await dial(expandServer(server), options.signal);
      } catch (err) {
        warn(`mcp: skip server ${quote(name)}: ${messageOf(err)}\n`);
        options.progress?.({ phase: "failed", server: name, total });
        continue;
      }
      let tools;
      try {
        tools = await session.listTools();
      } catch (err) {
        warn(`mcp: list tools from ${quote(name)} failed: ${messageOf(err)}\n`);
        await session.close().catch(() => {});
        options.progress?.({ phase: "failed", server: name, total });
        continue;
      }
      for (const tool of tools) {
        const schema = splitSchema(tool.inputSchema);
        if (!schema) {
          warn(`mcp: skip ${name}/${tool.name}: unrecognized input schema\n`);
          continue;
        }
        registry.register(
          new MCPTool(session, tool.name, {
            name: `${name}_${tool.name}`,
            description: tool.description,
            inputSchema: schema.properties,
            required: schema.required,
          }),
        );
      }
      opened.push(session);
      options.progress?.({ phase: "connected", server: name, total });
    }
  } finally {
    options.progress?.({ phase: "done", total });
  }
  return opened;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
