import { spawn } from "node:child_process";

import type { Tool } from "./registry.ts";
import { capOutput } from "./cap.ts";

/**
 * cmd.exe parses the tail of `/c` itself. `/s` plus a wrapping quote pair is
 * the documented way to hand it one command string without Node quoting the
 * argument a second time. `/d` skips AutoRun entries in the registry.
 */
export function runCmd(
  command: string,
  signal?: AbortSignal,
): Promise<{ code: number | null; output: string; cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ code: null, output: "", cancelled: true });
      return;
    }

    let settled = false;
    const finish = (code: number | null, output: string, cancelled: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ code, output, cancelled });
    };

    // stdin is ignored so a command that reads input cannot hang the turn.
    // Abort is not passed to spawn: Node kills only cmd.exe, and cmd often
    // starts a grandchild. taskkill /t tears down that tree.
    const child = spawn("cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onAbort = () => {
      if (child.pid === undefined) {
        child.kill();
        return;
      }
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      finish(code, Buffer.concat(chunks).toString("utf8"), signal?.aborted === true);
    });
  });
}

export const cmdTool: Tool = {
  definition() {
    return {
      name: "cmd",
      description:
        "Run a command with cmd.exe and return combined stdout and stderr. The shell is cmd.exe, not PowerShell or Bash.",
      inputSchema: {
        command: {
          type: "string",
          description: "The cmd.exe command to execute.",
        },
      },
      required: ["command"],
    };
  },

  async execute(rawInput, ctx) {
    let command: string;
    try {
      const parsed = JSON.parse(rawInput) as { command?: unknown };
      if (typeof parsed.command !== "string" || parsed.command.trim() === "") {
        return { result: "invalid tool input: `command` is required", isError: true };
      }
      command = parsed.command;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `invalid tool input: ${message}`, isError: true };
    }

    try {
      const { code, output, cancelled } = await runCmd(command, ctx.signal);
      if (cancelled) {
        const text = output === "" ? "command cancelled" : `${output}\ncommand cancelled`;
        return { result: capOutput(text), isError: true };
      }
      if (code !== 0) {
        return {
          result: capOutput(`${output}\n[exit error: exit status ${code}]`),
          isError: true,
        };
      }
      return { result: capOutput(output), isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: message, isError: true };
    }
  },
};
