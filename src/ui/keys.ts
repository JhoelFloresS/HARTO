export type Key =
  | { kind: "text"; text: string }
  | {
      kind:
        | "enter"
        | "backspace"
        | "tab"
        | "esc"
        | "up"
        | "down"
        | "left"
        | "right"
        | "pgup"
        | "pgdown"
        | "home"
        | "end"
        | "ctrlc"
        | "ctrld";
    };

/** Pulls complete keystrokes out of a raw stdin chunk. `rest` is an unfinished escape. */
export function parseKeys(input: string): { keys: Key[]; rest: string } {
  const keys: Key[] = [];
  let text = "";
  let i = 0;
  const flush = () => {
    if (text === "") return;
    keys.push({ kind: "text", text });
    text = "";
  };
  while (i < input.length) {
    const ch = input[i] ?? "";
    if (ch === "\x1b") {
      if (i + 1 >= input.length) {
        flush();
        return { keys, rest: input.slice(i) };
      }
      if (input[i + 1] !== "[") {
        flush();
        keys.push({ kind: "esc" });
        i += 1;
        continue;
      }
      const match = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(input.slice(i));
      if (!match) {
        if (input.length - i > 8) {
          flush();
          keys.push({ kind: "esc" });
          i += 1;
          continue;
        }
        flush();
        return { keys, rest: input.slice(i) };
      }
      flush();
      keys.push(csi(match[1] ?? "", match[2] ?? ""));
      i += match[0].length;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      flush();
      keys.push({ kind: "enter" });
      i += 1;
      continue;
    }
    if (ch === "\t") {
      flush();
      keys.push({ kind: "tab" });
      i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      flush();
      keys.push({ kind: "backspace" });
      i += 1;
      continue;
    }
    if (ch === "\x03") {
      flush();
      keys.push({ kind: "ctrlc" });
      i += 1;
      continue;
    }
    if (ch === "\x04") {
      flush();
      keys.push({ kind: "ctrld" });
      i += 1;
      continue;
    }
    if (ch >= " ") {
      text += ch;
      i += 1;
      continue;
    }
    i += 1;
  }
  flush();
  return { keys, rest: "" };
}

function csi(params: string, final: string): Key {
  if (final === "A") return { kind: "up" };
  if (final === "B") return { kind: "down" };
  if (final === "C") return { kind: "right" };
  if (final === "D") return { kind: "left" };
  if (final === "H" || (final === "~" && (params === "1" || params === "7"))) return { kind: "home" };
  if (final === "F" || (final === "~" && (params === "4" || params === "8"))) return { kind: "end" };
  if (final === "~" && params === "5") return { kind: "pgup" };
  if (final === "~" && params === "6") return { kind: "pgdown" };
  return { kind: "esc" };
}

/** Ink's useInput key, mapped onto the same union the model already handles. */
export function fromInkKey(
  input: string,
  key: {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    pageDown: boolean;
    pageUp: boolean;
    home: boolean;
    end: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    meta: boolean;
  },
): Key | null {
  if (key.ctrl && (input === "c" || input === "\x03")) return { kind: "ctrlc" };
  if (key.ctrl && (input === "d" || input === "\x04")) return { kind: "ctrld" };
  if (key.return) return { kind: "enter" };
  if (key.escape) return { kind: "esc" };
  if (key.tab) return { kind: "tab" };
  if (key.backspace || key.delete) return { kind: "backspace" };
  if (key.upArrow) return { kind: "up" };
  if (key.downArrow) return { kind: "down" };
  if (key.leftArrow) return { kind: "left" };
  if (key.rightArrow) return { kind: "right" };
  if (key.pageUp) return { kind: "pgup" };
  if (key.pageDown) return { kind: "pgdown" };
  if (key.home) return { kind: "home" };
  if (key.end) return { kind: "end" };
  if (key.ctrl || key.meta) return null;
  const text = input.replace(/[\r\n]/g, "");
  if (text !== "" && !text.includes("\u001b")) return { kind: "text", text };
  return null;
}
