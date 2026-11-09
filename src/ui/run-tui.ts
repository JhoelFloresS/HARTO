import { createElement } from "react";
import { render } from "ink";

import { TuiApp } from "./screen.ts";
import { TuiModel } from "./tui.ts";

/**
 * Alternate screen, restored by Ink on the way out. That includes `/exit`,
 * which ends the process without returning here.
 */
export async function runTui(
  model: TuiModel,
  submit: (line: string, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("tui: stdin is not a terminal");
  }

  let resolveQuit: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });
  const instance = render(createElement(TuiApp, { model, submit, onQuit: () => resolveQuit() }), {
    exitOnCtrlC: false,
    patchConsole: false,
    alternateScreen: true,
    interactive: true,
  });

  try {
    await closed;
  } finally {
    instance.unmount();
  }
}
