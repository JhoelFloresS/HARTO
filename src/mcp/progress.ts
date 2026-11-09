export type McpProgress =
  | { phase: "begin"; total: number }
  | { phase: "connecting" | "connected" | "failed"; server: string; total: number }
  | { phase: "done"; total: number };

export interface McpProgressState {
  finished: number;
  failed: number;
}

/**
 * REPL stand-in for the status line the TUI will own.
 * `connecting` names the server in flight; `done` is the line that replaces it.
 */
export function noteMcpProgress(event: McpProgress, state: McpProgressState): string | null {
  if (event.phase === "connecting") {
    return `connecting MCP: ${event.server} (${state.finished + 1}/${event.total})`;
  }
  if (event.phase === "connected") {
    state.finished += 1;
    return null;
  }
  if (event.phase === "failed") {
    state.finished += 1;
    state.failed += 1;
    return null;
  }
  if (event.phase === "done" && event.total > 0) {
    const ready = state.finished - state.failed;
    const noun = ready === 1 ? "server" : "servers";
    const failed = state.failed > 0 ? ` · ${state.failed} failed` : "";
    return `MCP ready (${ready} ${noun})${failed}`;
  }
  return null;
}
