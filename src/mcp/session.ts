/** One connected server. register.ts and the SDK wrapper both speak this, not the SDK. */
export interface McpSession {
  listTools(): Promise<RemoteTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface RemoteTool {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface McpContent {
  type?: string;
  text?: string;
}

export interface McpToolResult {
  content: McpContent[];
  isError: boolean;
}

/** Second close is a no-op. Stdio close is what kills the child process. */
export function guardClose(session: McpSession): McpSession {
  let closed = false;
  return {
    listTools: () => session.listTools(),
    callTool: (name, args, signal) => session.callTool(name, args, signal),
    async close() {
      if (closed) return;
      closed = true;
      await session.close();
    },
  };
}
