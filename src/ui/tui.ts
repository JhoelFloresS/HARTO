import type { DebugEvent } from "../debug/debug.ts";
import type { McpProgress } from "../mcp/progress.ts";
import { activeMention, filterMentions, insertMention, type MentionItem } from "../mention/mention.ts";
import { bannerText } from "./banner.ts";
import { appendHistory } from "./history.ts";
import type { Key } from "./keys.ts";
import { measureModal, measureScreen, type ScreenSlots } from "./layout.ts";

export type Phase = "idle" | "running" | "approval";

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  reports: boolean;
}

export interface TuiOptions {
  width?: number;
  height?: number;
  history?: string[];
  historyPath?: string;
  usage?: () => UsageSnapshot;
  subagents?: () => Array<{ name: string; count: number }>;
  debugEnabled?: () => boolean;
  debugSnapshot?: () => DebugEvent[];
  now?: () => Date;
  project?: string;
  mentions?: () => MentionItem[];
}

export type TuiAction =
  | { type: "none" }
  | { type: "submit"; line: string; signal: AbortSignal }
  | { type: "quit" };

export interface TuiViewState {
  width: number;
  height: number;
  mode: "main" | "approval" | "debug-detail";
  lines: string[];
  slots: ScreenSlots;
  status: string;
  input: string;
  hint: string;
  project: string;
  mention: { items: MentionItem[]; selected: number } | null;
  debugLines: string[];
  approval: { prompt: string; lines: string[] } | null;
  debugDetail: { title: string; lines: string[] } | null;
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const mentionLimit = 8;

/**
 * Nivel B screen. Keys go in, a frame comes out. The terminal driver is separate
 * so tests never need a PTY.
 */
export class TuiModel {
  phase: Phase = "idle";
  width: number;
  height: number;
  onChange: (() => void) | null = null;

  private lines: string[];
  private follow = true;
  private anchor = 0;
  private input = "";
  private cursor = 0;
  private history: string[];
  private historyPath: string;
  private histIdx = -1;
  private buffer = "";
  private approvalPrompt = "";
  private approvalDetail = "";
  private detailScroll = 0;
  private pending: ((ok: boolean) => void) | null = null;
  private controller: AbortController | null = null;
  private spinner = 0;
  private debugFocus = false;
  private debugMode: "list" | "detail" = "list";
  private debugSelected = 0;
  private mcpLoading = false;
  private mcpTotal = 0;
  private mcpDone = 0;
  private mcpFailed = 0;
  private mcpCurrent = "";
  private usage: () => UsageSnapshot;
  private subagents: () => Array<{ name: string; count: number }>;
  private debugOn: () => boolean;
  private debugEvents: () => DebugEvent[];
  private now: () => Date;
  private project: string;
  private listMentions: () => MentionItem[];
  private catalog: MentionItem[] | null = null;
  private mention: { start: number; query: string; items: MentionItem[]; selected: number } | null = null;
  private dismissed: { start: number; query: string } | null = null;
  private partial = "";
  private asker: ((line: string) => void) | null = null;

  constructor(options: TuiOptions = {}) {
    this.width = options.width ?? 80;
    this.height = options.height ?? 24;
    this.history = (options.history ?? []).slice();
    this.historyPath = options.historyPath ?? "";
    this.usage = options.usage ?? (() => emptyUsage());
    this.subagents = options.subagents ?? (() => []);
    this.debugOn = options.debugEnabled ?? (() => false);
    this.debugEvents = options.debugSnapshot ?? (() => []);
    this.now = options.now ?? (() => new Date());
    this.project = options.project ?? "";
    this.listMentions = options.mentions ?? (() => []);
    this.lines = bannerText(this.project).split("\n");
  }

  resize(width: number, height: number): void {
    this.width = Math.max(width, 20);
    this.height = Math.max(height, 8);
  }

  append(line: string): void {
    if (this.partial !== "") {
      this.lines.push(this.partial);
      this.partial = "";
    }
    const parts = line.split("\n");
    for (const part of parts) this.lines.push(part);
    this.changed();
  }

  /** Visible text while the model is still producing the current line. */
  stream(delta: string): void {
    this.partial += delta;
    const parts = this.partial.split("\n");
    this.partial = parts.pop() ?? "";
    for (const part of parts) this.lines.push(part);
    this.changed();
  }

  setProject(label: string): void {
    this.project = label;
    this.changed();
  }

  /** The next submitted line answers a slash command instead of starting a turn. */
  ask(): Promise<string> {
    return new Promise((resolve) => {
      this.asker = resolve;
    });
  }

  private resolveAsk(line: string): void {
    const resolve = this.asker;
    this.asker = null;
    resolve?.(line);
    this.changed();
  }

  noteMcp(event: McpProgress): void {
    if (event.phase === "begin") {
      if (event.total === 0) return;
      this.mcpLoading = true;
      this.mcpTotal = event.total;
      this.mcpDone = 0;
      this.mcpFailed = 0;
      this.mcpCurrent = "";
    } else if (event.phase === "connecting") {
      this.mcpCurrent = event.server;
    } else if (event.phase === "connected") {
      this.mcpDone += 1;
      this.mcpCurrent = "";
    } else if (event.phase === "failed") {
      this.mcpDone += 1;
      this.mcpFailed += 1;
      this.mcpCurrent = "";
    } else if (event.phase === "done") {
      this.mcpLoading = false;
      this.mcpCurrent = "";
    }
    this.changed();
  }

  requestApproval(prompt: string, detail: string): Promise<boolean> {
    this.phase = "approval";
    this.approvalPrompt = prompt;
    this.approvalDetail = detail;
    this.detailScroll = 0;
    this.changed();
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  finishTurn(err?: unknown): void {
    if (this.pending) {
      this.pending(false);
      this.pending = null;
    }
    this.approvalPrompt = "";
    this.approvalDetail = "";
    this.phase = "idle";
    this.controller = null;
    if (err && !isAbort(err)) {
      const message = err instanceof Error ? err.message : String(err);
      this.lines.push(`error: ${message}`);
    }
    this.changed();
  }

  tick(): void {
    if (this.phase !== "running" && !this.mcpLoading) return;
    this.spinner = (this.spinner + 1) % spinnerFrames.length;
    this.changed();
  }

  refresh(): void {
    this.changed();
  }

  /** What Ink paints. Row counts come from Yoga so paging and the frame match. */
  view(): TuiViewState {
    const slots = this.slots();
    const debugOn = slots.debug > 0;
    const modal = measureModal(this.width, this.height);
    const mode = this.phase === "approval" && this.approvalDetail !== ""
      ? "approval"
      : this.debugFocus && this.debugMode === "detail" && debugOn
        ? "debug-detail"
        : "main";
    const event = this.debugEvents().find((item) => item.id === this.debugSelected);
    const payload = event?.payload ?? "";
    return {
      width: this.width,
      height: this.height,
      mode,
      lines: this.window(slots.scroll),
      slots,
      status: this.statusLine(),
      input: this.input,
      hint: this.mention
        ? "↑↓ select · enter/tab insert · esc close"
        : debugOn
          ? "enter: send · tab: debug panel · pgup/pgdn: scroll · ctrl-c: cancel · ctrl-d: exit"
          : "enter: send · pgup/pgdn: scroll · ctrl-c: cancel · ctrl-d: exit",
      project: this.project,
      mention: this.mention ? { items: this.mention.items, selected: this.mention.selected } : null,
      debugLines: debugOn ? this.debugLines(slots.debug) : [],
      approval: mode === "approval"
        ? { prompt: this.approvalPrompt, lines: this.detailLines(this.approvalDetail, modal.body) }
        : null,
      debugDetail: mode === "debug-detail"
        ? {
            title: event ? `#${event.id} ${event.source} ${event.message}` : `#${this.debugSelected} (event no longer in the ring)`,
            lines: this.detailLines(payload, modal.body),
          }
        : null,
    };
  }

  handle(key: Key): TuiAction {
    if (this.asker && (key.kind === "esc" || key.kind === "ctrlc")) {
      this.resolveAsk("");
      return { type: "none" };
    }
    if (this.phase === "approval") return this.handleApproval(key);
    if (this.phase !== "idle" || this.debugFocus) this.mention = null;
    else this.syncMention();
    if (this.mention && key.kind === "tab") return this.acceptMention();
    if (this.mention && key.kind === "esc") return this.closeMention();
    if (key.kind === "tab" && this.debugOn()) return this.toggleDebug();
    if (this.debugFocus && this.debugOn()) return this.handleDebug(key);
    return this.handleInput(key);
  }

  private handleInput(key: Key): TuiAction {
    if (key.kind === "ctrlc") {
      if (this.phase === "running") {
        this.controller?.abort();
        this.lines.push("cancelled");
        this.changed();
        return { type: "none" };
      }
      return { type: "quit" };
    }
    if (key.kind === "ctrld") {
      if (this.phase === "idle") return { type: "quit" };
      return { type: "none" };
    }
    if (key.kind === "pgup") {
      this.page(-this.slots().scroll);
      return { type: "none" };
    }
    if (key.kind === "pgdown") {
      this.page(this.slots().scroll);
      return { type: "none" };
    }
    if (this.phase !== "idle" && !this.asker) return { type: "none" };
    if (this.mention && (key.kind === "up" || key.kind === "down")) {
      const last = this.mention.items.length - 1;
      if (last >= 0 && key.kind === "up") this.mention.selected = Math.max(0, this.mention.selected - 1);
      if (last >= 0 && key.kind === "down") this.mention.selected = Math.min(last, this.mention.selected + 1);
      return { type: "none" };
    }
    if (key.kind === "enter") {
      if (this.asker) {
        const line = this.input.trim();
        this.input = "";
        this.cursor = 0;
        this.lines.push(`❯ ${line}`);
        this.follow = true;
        this.resolveAsk(line);
        return { type: "none" };
      }
      if (this.mention) return this.acceptMention();
      const line = this.input.trim();
      if (line === "") return { type: "none" };
      this.input = "";
      this.cursor = 0;
      this.histIdx = -1;
      this.buffer = "";
      this.history.push(line);
      appendHistory(this.historyPath, line);
      const stamp = this.now().toLocaleTimeString("en-GB", { hour12: false });
      this.lines.push("", `── ${stamp} ${"─".repeat(8)}`, `❯ ${line}`, "");
      this.follow = true;
      this.phase = "running";
      this.mention = null;
      this.catalog = null;
      this.dismissed = null;
      this.controller = new AbortController();
      this.changed();
      return { type: "submit", line, signal: this.controller.signal };
    }
    if (key.kind === "up") return this.recall(-1);
    if (key.kind === "down") return this.recall(1);
    if (key.kind === "left") {
      this.cursor = Math.max(0, this.cursor - 1);
      return { type: "none" };
    }
    if (key.kind === "right") {
      this.cursor = Math.min(this.input.length, this.cursor + 1);
      return { type: "none" };
    }
    if (key.kind === "home") {
      this.cursor = 0;
      return { type: "none" };
    }
    if (key.kind === "end") {
      this.cursor = this.input.length;
      return { type: "none" };
    }
    if (key.kind === "backspace") {
      if (this.cursor === 0) return { type: "none" };
      this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
      this.cursor -= 1;
      this.histIdx = -1;
      return { type: "none" };
    }
    if (key.kind === "text") {
      this.input = this.input.slice(0, this.cursor) + key.text + this.input.slice(this.cursor);
      this.cursor += key.text.length;
      this.histIdx = -1;
      return { type: "none" };
    }
    return { type: "none" };
  }

  private handleApproval(key: Key): TuiAction {
    if (this.approvalDetail !== "" && (key.kind === "up" || key.kind === "down" || key.kind === "pgup" || key.kind === "pgdown")) {
      const step = key.kind === "pgup" || key.kind === "pgdown" ? 8 : 1;
      const sign = key.kind === "up" || key.kind === "pgup" ? -1 : 1;
      const max = Math.max(0, this.approvalDetail.split("\n").length - measureModal(this.width, this.height).body);
      this.detailScroll = Math.min(max, Math.max(0, this.detailScroll + sign * step));
      this.changed();
      return { type: "none" };
    }
    if (key.kind === "text" && (key.text === "y" || key.text === "Y")) return this.answer(true);
    if (key.kind === "text" && (key.text === "n" || key.text === "N")) return this.answer(false);
    if (key.kind === "esc") return this.answer(false);
    if (key.kind === "ctrlc") {
      this.controller?.abort();
      this.lines.push("cancelled");
      return this.answer(false);
    }
    return { type: "none" };
  }

  private answer(ok: boolean): TuiAction {
    const resolve = this.pending;
    this.pending = null;
    this.approvalPrompt = "";
    this.approvalDetail = "";
    this.phase = "running";
    this.lines.push(ok ? "  ↳ approved" : "  ↳ denied");
    resolve?.(ok);
    this.changed();
    return { type: "none" };
  }

  private toggleDebug(): TuiAction {
    this.debugFocus = !this.debugFocus;
    if (!this.debugFocus) this.debugMode = "list";
    else if (this.debugSelected === 0) {
      const last = this.debugEvents().at(-1);
      this.debugSelected = last?.id ?? 0;
    }
    return { type: "none" };
  }

  private handleDebug(key: Key): TuiAction {
    if (key.kind === "esc" || key.kind === "tab") {
      if (this.debugMode === "detail" && key.kind === "esc") {
        this.debugMode = "list";
        return { type: "none" };
      }
      this.debugFocus = false;
      this.debugMode = "list";
      return { type: "none" };
    }
    if (key.kind === "ctrld" && this.phase === "idle") return { type: "quit" };
    if (key.kind === "ctrlc") {
      if (this.phase === "running") {
        this.controller?.abort();
        this.lines.push("cancelled");
        this.changed();
        return { type: "none" };
      }
      return { type: "quit" };
    }
    const events = this.debugEvents();
    if (this.debugMode === "list") {
      const index = Math.max(0, events.findIndex((event) => event.id === this.debugSelected));
      if (key.kind === "up") this.debugSelected = events[Math.max(0, index - 1)]?.id ?? this.debugSelected;
      if (key.kind === "down") this.debugSelected = events[Math.min(events.length - 1, index + 1)]?.id ?? this.debugSelected;
      if (key.kind === "home") this.debugSelected = events[0]?.id ?? 0;
      if (key.kind === "end") this.debugSelected = events.at(-1)?.id ?? 0;
      if (key.kind === "enter") {
        this.detailScroll = 0;
        this.debugMode = "detail";
      }
      return { type: "none" };
    }
    if (key.kind === "pgup") this.detailScroll = Math.max(0, this.detailScroll - 8);
    if (key.kind === "pgdown") this.detailScroll += 8;
    return { type: "none" };
  }

  private recall(direction: number): TuiAction {
    if (this.history.length === 0 || this.phase !== "idle") return { type: "none" };
    if (direction < 0) {
      if (this.histIdx === -1) this.buffer = this.input;
      if (this.histIdx < this.history.length - 1) this.histIdx += 1;
    } else if (this.histIdx === -1) {
      return { type: "none" };
    } else if (this.histIdx === 0) {
      this.histIdx = -1;
      this.input = this.buffer;
      this.cursor = this.input.length;
      return { type: "none" };
    } else {
      this.histIdx -= 1;
    }
    const picked = this.history[this.history.length - 1 - this.histIdx] ?? "";
    this.input = picked;
    this.cursor = picked.length;
    return { type: "none" };
  }

  private page(delta: number): void {
    const rows = this.slots().scroll;
    const maxAnchor = Math.max(0, this.lines.length - rows);
    if (this.follow) this.anchor = maxAnchor;
    this.anchor = Math.min(maxAnchor, Math.max(0, this.anchor + delta));
    this.follow = this.anchor >= maxAnchor;
  }

  private window(rows: number): string[] {
    const source = this.partial === "" ? this.lines : this.lines.concat(this.partial);
    if (this.follow) this.anchor = Math.max(0, source.length - rows);
    const slice = source.slice(this.anchor, this.anchor + rows);
    while (slice.length < rows) slice.push("");
    return slice;
  }

  private slots(): ScreenSlots {
    this.syncMention();
    return measureScreen(this.width, this.height, this.debugOn(), this.mentionRows());
  }

  private mentionRows(): number {
    if (!this.mention) return 0;
    return Math.min(mentionLimit, Math.max(1, this.mention.items.length)) + 2;
  }

  private syncMention(): void {
    if (this.phase !== "idle" || this.debugFocus || this.asker) {
      this.mention = null;
      return;
    }
    const active = activeMention(this.input, this.cursor);
    if (!active) {
      this.mention = null;
      this.catalog = null;
      this.dismissed = null;
      return;
    }
    if (this.dismissed && this.dismissed.start === active.start && this.dismissed.query === active.query) {
      this.mention = null;
      return;
    }
    if (!this.catalog) {
      try {
        this.catalog = this.listMentions();
      } catch {
        this.catalog = [];
      }
    }
    const items = filterMentions(this.catalog, active.query, mentionLimit);
    const previous = this.mention;
    let selected = 0;
    if (previous && previous.start === active.start && previous.query === active.query) {
      selected = Math.min(previous.selected, Math.max(0, items.length - 1));
    }
    this.mention = { start: active.start, query: active.query, items, selected: items.length === 0 ? 0 : selected };
  }

  private acceptMention(): TuiAction {
    const current = this.mention;
    if (!current) return { type: "none" };
    const pick = current.items[current.selected];
    if (!pick) return { type: "none" };
    const next = insertMention(this.input, this.cursor, current.start, pick.path);
    this.input = next.input;
    this.cursor = next.cursor;
    this.histIdx = -1;
    this.mention = null;
    this.dismissed = null;
    this.catalog = null;
    return { type: "none" };
  }

  private closeMention(): TuiAction {
    if (!this.mention) return { type: "none" };
    this.dismissed = { start: this.mention.start, query: this.mention.query };
    this.mention = null;
    return { type: "none" };
  }

  private detailLines(text: string, rows: number): string[] {
    return text.split("\n").slice(this.detailScroll, this.detailScroll + Math.max(1, rows));
  }

  private debugLines(rows: number): string[] {
    const events = this.debugEvents();
    const title = this.debugFocus ? " debug *" : " debug";
    const body: string[] = [title];
    if (events.length === 0) body.push("(no debug events yet)");
    else {
      const room = Math.max(1, rows - 1);
      const start = Math.max(0, events.length - room);
      for (const event of events.slice(start)) {
        const mark = event.id === this.debugSelected ? ">" : " ";
        const dot = event.payload !== "" ? " •" : "";
        body.push(`${mark} #${event.id} ${event.source} ${event.message}${dot}`);
      }
    }
    return body.slice(0, Math.max(1, rows));
  }

  private statusLine(): string {
    if (this.phase === "approval" && this.approvalDetail === "") {
      return ` ? ${this.approvalPrompt} (y/n)`;
    }
    if (this.phase === "running") {
      return this.withProject(`${spinnerFrames[this.spinner]} thinking...${this.subagentText()}`);
    }
    if (this.mcpLoading) return this.withProject(`${spinnerFrames[this.spinner]} ${this.mcpText()}`);
    return this.withProject(this.usageText());
  }

  private withProject(body: string): string {
    if (this.project === "") return ` ${body}`;
    if (body === "") return ` ${this.project}`;
    return ` ${this.project} · ${body}`;
  }

  private subagentText(): string {
    const active = this.subagents();
    if (active.length === 0) return "";
    const parts = active.map((item) => (item.count === 1 ? item.name : `${item.name} ×${item.count}`));
    return ` · ${parts.join(", ")}`;
  }

  private mcpText(): string {
    let msg: string;
    if (this.mcpCurrent !== "") msg = `connecting MCP: ${this.mcpCurrent} (${this.mcpDone + 1}/${this.mcpTotal})`;
    else if (this.mcpDone < this.mcpTotal) msg = `connecting MCP (${this.mcpDone}/${this.mcpTotal})`;
    else {
      const ready = this.mcpDone - this.mcpFailed;
      msg = `MCP ready (${ready} server${ready === 1 ? "" : "s"})`;
    }
    if (this.mcpFailed > 0) msg += ` · ${this.mcpFailed} failed`;
    return msg;
  }

  private usageText(): string {
    const usage = this.usage();
    if (!usage.reports) return "";
    if (usage.inputTokens === 0 && usage.outputTokens === 0) return "";
    const parts = [`${group(usage.inputTokens)} in`, `${group(usage.outputTokens)} out`];
    if (usage.cacheCreationTokens > 0 || usage.cacheReadTokens > 0) {
      parts.push(`cache ${group(usage.cacheCreationTokens)}/${group(usage.cacheReadTokens)}`);
    }
    if (usage.costUsd >= 0) parts.push(`~$${usage.costUsd.toFixed(4)}`);
    return parts.join(" · ");
  }

  private changed(): void {
    this.onChange?.();
  }
}

function emptyUsage(): UsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: -1,
    reports: false,
  };
}

function group(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(Math.trunc(value)));
  const text = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${text}` : text;
}

function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && (err as { name?: string }).name === "AbortError";
}
