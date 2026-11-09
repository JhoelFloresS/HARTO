import { readFileSync } from "node:fs";

import type { ServerConfig } from "./config.ts";
import { guardClose, type McpContent, type McpSession, type McpToolResult, type RemoteTool } from "./session.ts";

/**
 * Opens one server. Validates the entry before touching the SDK, so a bad
 * config fails even when the package is not installed yet.
 */
export async function connectServer(server: ServerConfig, signal?: AbortSignal): Promise<McpSession> {
  if (server.transport === "stdio") {
    if (!server.command) throw new Error(`stdio server ${quote(server.name)} missing command`);
    return openStdio(server.command, server.args ?? [], signal);
  }
  if (server.transport === "http") {
    if (!server.url) throw new Error(`http server ${quote(server.name)} missing url`);
    return openHttp(server.url, server.headers ?? {}, signal);
  }
  throw new Error(`unknown transport ${quote(server.transport)} (want stdio or http)`);
}

async function openStdio(command: string, args: string[], signal?: AbortSignal): Promise<McpSession> {
  const specifier = "@modelcontextprotocol/client/stdio";
  const sdk = (await import(specifier)) as {
    StdioClientTransport: new (params: { command: string; args: string[] }) => SdkTransport;
  };
  const transport = new sdk.StdioClientTransport({ command, args });
  return connectTransport(transport, signal);
}

async function openHttp(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<McpSession> {
  const specifier = "@modelcontextprotocol/client";
  const sdk = (await import(specifier)) as {
    StreamableHTTPClientTransport: new (
      url: URL,
      opts?: { requestInit?: { headers?: Record<string, string> } },
    ) => SdkTransport;
  };
  const transport = new sdk.StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  return connectTransport(transport, signal);
}

async function connectTransport(transport: SdkTransport, signal?: AbortSignal): Promise<McpSession> {
  const specifier = "@modelcontextprotocol/client";
  const sdk = (await import(specifier)) as {
    Client: new (info: { name: string; version: string }) => SdkClient;
  };
  const client = new sdk.Client({ name: "harto", version: harnessVersion() });
  try {
    await untilConnected(client, transport, signal);
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
  return guardClose({
    async listTools() {
      const listed = await client.listTools();
      return (listed.tools ?? []).map(toRemoteTool);
    },
    async callTool(name, args, callSignal) {
      const result = await client.callTool(
        { name, arguments: args },
        callSignal ? { signal: callSignal } : undefined,
      );
      return {
        content: (result.content ?? []) as McpContent[],
        isError: result.isError === true,
      };
    },
    async close() {
      if (typeof transport.terminateSession === "function") {
        await transport.terminateSession().catch(() => {});
      }
      await client.close();
    },
  });
}

function untilConnected(client: SdkClient, transport: SdkTransport, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("mcp connect aborted"));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    client.connect(transport).then(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      (err: unknown) => {
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function toRemoteTool(tool: { name?: unknown; description?: unknown; inputSchema?: unknown }): RemoteTool {
  return {
    name: typeof tool.name === "string" ? tool.name : "",
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: tool.inputSchema,
  };
}

function harnessVersion(): string {
  try {
    const file = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: string };
    return pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

interface SdkTransport {
  terminateSession?: () => Promise<void>;
}

interface SdkClient {
  connect(transport: SdkTransport): Promise<void>;
  listTools(): Promise<{ tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }> }>;
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ): Promise<McpToolResult & { content?: McpContent[] }>;
  close(): Promise<void>;
}
