import { createInterface, type Interface } from "node:readline";

import type { CommandContext } from "../commands.ts";
import { runCommand } from "../commands.ts";
import { expandMentions } from "../mention/mention.ts";
import { bannerAnsi } from "./banner.ts";

/**
 * Level A: one line in, slash commands or one agent turn, y/n on the same stdin.
 * A second line during a turn is ignored. Ctrl-C aborts the turn; at idle it closes.
 */
export async function runRepl(ctx: CommandContext, project = ""): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "\x1b[38;2;192;132;252m❯ \x1b[0m" });
  let busy = false;
  let controller: AbortController | null = null;
  let pending: ((answer: string) => void) | null = null;

  ctx.agent.confirm = async (prompt, detail) => {
    if (detail) ctx.write(detail);
    ctx.write(`${prompt} [y/n]`);
    const answer = (await ask()).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  };

  function ask(): Promise<string> {
    return new Promise((resolve) => {
      pending = resolve;
    });
  }

  let closed = false;

  process.stdout.write(`${bannerAnsi(project)}\n`);
  rl.prompt();

  await new Promise<void>((resolve) => {
    rl.on("line", (line) => {
      void onLine(line);
    });
    rl.on("SIGINT", () => onSigint(rl));
    rl.on("close", () => {
      closed = true;
      resolve();
    });
  });

  async function onLine(line: string): Promise<void> {
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve(line);
      return;
    }
    if (busy) {
      ctx.write("a turn is already running");
      return;
    }
    if (line.trim() === "") {
      rl.prompt();
      return;
    }
    busy = true;
    controller = new AbortController();
    try {
      if (!(await runCommand(line, ctx))) {
        await ctx.agent.send(expandMentions(line, process.cwd()), { signal: controller.signal });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.write(message);
    } finally {
      busy = false;
      controller = null;
      if (!closed) rl.prompt();
    }
  }

  function onSigint(reader: Interface): void {
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve("n");
    }
    if (busy && controller) {
      controller.abort();
      ctx.write("cancelled");
      return;
    }
    if (!busy) reader.close();
  }
}
