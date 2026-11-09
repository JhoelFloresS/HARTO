import { createElement as h, useEffect, useState, type ReactNode } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";

import { setDebugSink } from "../debug/debug.ts";
import { isSubtitle, isWordmark, violet, violetSoft } from "./banner.ts";
import { fromInkKey } from "./keys.ts";
import type { TuiModel, TuiViewState } from "./tui.ts";

/** createElement, not JSX: the process strips types and does not transform JSX. */
export function TuiScreen(props: { model: TuiModel }): ReactNode {
  const view = props.model.view();
  if (view.mode === "approval" && view.approval) return approval(view);
  if (view.mode === "debug-detail" && view.debugDetail) return debugDetail(view);
  return main(view);
}

export function TuiApp(props: {
  model: TuiModel;
  submit: (line: string, signal: AbortSignal) => Promise<void>;
  onQuit: () => void;
}): ReactNode {
  const [, setRev] = useState(0);
  const { columns, rows } = useWindowSize();
  const bump = () => setRev((n) => n + 1);
  props.model.onChange = bump;

  useEffect(() => {
    if (columns > 0 && rows > 0) props.model.resize(columns, rows);
    bump();
  }, [columns, rows, props.model]);

  useEffect(() => {
    setDebugSink(() => props.model.refresh());
    const timer = setInterval(() => props.model.tick(), 80);
    return () => {
      clearInterval(timer);
      setDebugSink(null);
      props.model.onChange = null;
    };
  }, [props.model]);

  useInput((input, key) => {
    const mapped = fromInkKey(input, key);
    if (!mapped) return;
    const action = props.model.handle(mapped);
    if (action.type === "quit") {
      props.onQuit();
      return;
    }
    if (action.type === "submit") {
      void props.submit(action.line, action.signal).then(
        () => props.model.finishTurn(),
        (err: unknown) => props.model.finishTurn(err),
      );
    }
    bump();
  });

  return h(TuiScreen, { model: props.model });
}

function main(view: TuiViewState): ReactNode {
  const children: ReactNode[] = [
    h(
      Box,
      { key: "scroll", height: view.slots.scroll, overflowY: "hidden", flexDirection: "column" },
      texts(view.lines, "s", false, view.project),
    ),
  ];
  if (view.slots.debug > 0) {
    children.push(
      h(
        Box,
        { key: "debug", height: view.slots.debug, overflowY: "hidden", flexDirection: "column" },
        texts(view.debugLines, "g", true),
      ),
    );
  }
  children.push(h(Box, { key: "status", height: view.slots.status }, h(Text, { color: violet, wrap: "truncate-end" }, view.status || " ")));
  if (view.slots.mention > 0 && view.mention) {
    const rows = view.mention.items.length === 0
      ? [h(Text, { key: "empty", dimColor: true, wrap: "truncate-end" }, " no matches")]
      : view.mention.items.map((item, index) => {
          const selected = index === view.mention?.selected;
          const label = item.kind === "dir" ? `${item.path}/` : item.path;
          return h(
            Text,
            { key: `${item.kind}:${item.path}`, color: selected ? violet : undefined, bold: selected, wrap: "truncate-end" },
            selected ? `❯ ${label}` : `  ${label}`,
          );
        });
    children.push(
      h(
        Box,
        {
          key: "mention",
          height: view.slots.mention,
          flexDirection: "column",
          overflowY: "hidden",
          borderStyle: "round",
          borderColor: violetSoft,
        },
        rows,
      ),
    );
  }
  children.push(
    h(
      Box,
      { key: "input", height: view.slots.input, flexDirection: "column" },
      h(
        Box,
        { borderStyle: "round", borderColor: violetSoft, height: Math.max(3, view.slots.input - 1) },
        h(Text, { wrap: "truncate-start" }, h(Text, { color: violet }, "❯ "), view.input),
      ),
      h(Text, { color: violetSoft, dimColor: true, wrap: "truncate-end" }, view.hint),
    ),
  );
  return h(Box, { width: view.width, height: view.height, flexDirection: "column" }, children);
}

function approval(view: TuiViewState): ReactNode {
  const body = view.approval;
  if (!body) return null;
  return h(
    Box,
    { width: view.width, height: view.height, flexDirection: "column" },
    h(Text, { color: violet, wrap: "truncate-end" }, body.prompt),
    h(Text, { color: violetSoft }, "─".repeat(Math.min(40, view.width))),
    h(Box, { flexGrow: 1, overflowY: "hidden", flexDirection: "column" }, body.lines.map((line, index) => diffText(line, index))),
    h(Text, null, " "),
    h(Text, { color: violetSoft, wrap: "truncate-end" }, "y: approve · n / esc: deny · ↑↓: scroll"),
  );
}

function debugDetail(view: TuiViewState): ReactNode {
  const body = view.debugDetail;
  if (!body) return null;
  return h(
    Box,
    { width: view.width, height: view.height, flexDirection: "column" },
    h(Text, { color: violet, wrap: "truncate-end" }, body.title),
    h(Text, { color: violetSoft }, "─".repeat(Math.min(40, view.width))),
    h(Box, { flexGrow: 1, overflowY: "hidden", flexDirection: "column" }, texts(body.lines, "p")),
    h(Text, null, " "),
    h(Text, { color: violetSoft, wrap: "truncate-end" }, "esc: back · pgup/pgdn: scroll · tab: input"),
  );
}

function diffText(line: string, index: number): ReactNode {
  let color: "green" | "red" | "cyan" | undefined;
  if (line.startsWith("+") && !line.startsWith("+++")) color = "green";
  else if (line.startsWith("-") && !line.startsWith("---")) color = "red";
  else if (line.startsWith("@@")) color = "cyan";
  return h(Text, { key: `d${index}`, color, wrap: "truncate-end" }, line === "" ? " " : line);
}

function texts(lines: string[], prefix: string, panel = false, project = ""): ReactNode[] {
  return lines.map((line, index) => {
    const look = panel ? panelTone(line) : scrollTone(line, project);
    return h(Text, { key: `${prefix}${index}`, ...look }, line === "" ? " " : line);
  });
}

function scrollTone(line: string, project: string): { color?: string; bold?: boolean; dimColor?: boolean; wrap: "truncate-end" } {
  if (isWordmark(line) || (project !== "" && line === project)) return { color: violet, bold: true, wrap: "truncate-end" };
  if (isSubtitle(line)) return { color: violetSoft, wrap: "truncate-end" };
  if (line.startsWith("type a message") || line.startsWith("──")) return { color: violetSoft, dimColor: true, wrap: "truncate-end" };
  if (line.startsWith("❯") || line.startsWith("  ↳")) return { color: violet, wrap: "truncate-end" };
  return { wrap: "truncate-end" };
}

function panelTone(line: string): { color?: string; bold?: boolean; wrap: "truncate-end" } {
  if (line.startsWith(" debug")) return { color: violet, bold: true, wrap: "truncate-end" };
  return { wrap: "truncate-end" };
}
