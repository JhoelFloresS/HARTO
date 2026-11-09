// In-memory ring surfaced later by /debug. Recording is a bool check when off.

export type Level = "info" | "warn" | "error";

export interface DebugEvent {
  id: number;
  correlatedId: number;
  time: Date;
  source: string;
  level: Level;
  message: string;
  payload: string;
}

const ringCapacity = 500;
const maxPayloadBytes = 100 * 1024;
const truncationMarker = "\n…[truncated]";

let events: DebugEvent[] = [];
let enabled = false;
let sink: ((event: DebugEvent) => void) | null = null;
let nextId = 0;

export function debugEnabled(): boolean {
  return enabled;
}

export function setDebugEnabled(value: boolean): void {
  enabled = value;
}

export function setDebugSink(next: ((event: DebugEvent) => void) | null): void {
  sink = next;
}

export function record(source: string, level: Level, message: string): number {
  return push(0, source, level, message, "");
}

export function recordf(source: string, level: Level, format: string, ...args: unknown[]): number {
  return push(0, source, level, formatMessage(format, args), "");
}

export function recordp(source: string, level: Level, message: string, payload: string): number {
  return push(0, source, level, message, truncatePayload(payload));
}

export function recordpc(
  startId: number,
  source: string,
  level: Level,
  message: string,
  payload: string,
): number {
  return push(startId, source, level, message, truncatePayload(payload));
}

export function recordfc(
  startId: number,
  source: string,
  level: Level,
  format: string,
  ...args: unknown[]
): number {
  return push(startId, source, level, formatMessage(format, args), "");
}

function push(
  correlatedId: number,
  source: string,
  level: Level,
  message: string,
  payload: string,
): number {
  if (!enabled) return 0;
  if (events.length >= ringCapacity) {
    events = events.slice(1);
  }
  const event: DebugEvent = {
    id: ++nextId,
    correlatedId,
    time: new Date(),
    source,
    level,
    message,
    payload,
  };
  events.push(event);
  const callback = sink;
  if (callback) callback(event);
  return event.id;
}

export function pair(id: number): DebugEvent | undefined {
  const target = events.find((event) => event.id === id);
  if (!target) return undefined;
  if (target.correlatedId !== 0) {
    return events.find((event) => event.id === target.correlatedId);
  }
  return events.find((event) => event.correlatedId === target.id);
}

export function findById(id: number): DebugEvent | undefined {
  return events.find((event) => event.id === id);
}

export function latest(): DebugEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].payload !== "") return events[i];
  }
  return events.at(-1);
}

export function snapshot(): DebugEvent[] {
  return events.slice();
}

export function clearDebug(): void {
  events = [];
}

function truncatePayload(payload: string): string {
  const bytes = Buffer.from(payload, "utf8");
  if (bytes.length <= maxPayloadBytes) return payload;
  return bytes.subarray(0, maxPayloadBytes).toString("utf8") + truncationMarker;
}

/** Supports the `%s` placeholders the call sites use. Other text is literal. */
function formatMessage(format: string, args: unknown[]): string {
  let index = 0;
  return format.replace(/%s/g, () => {
    const value = args[index++];
    return value === undefined ? "%s" : String(value);
  });
}
