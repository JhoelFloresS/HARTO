const active = new Map<string, number>();

/** Marks one in-flight run. The returned function drops the count and is meant for a finally block. */
export function beginSubagent(name: string): () => void {
  active.set(name, (active.get(name) ?? 0) + 1);
  return () => {
    const next = (active.get(name) ?? 1) - 1;
    if (next <= 0) active.delete(name);
    else active.set(name, next);
  };
}

export function activeSubagents(): Array<{ name: string; count: number }> {
  return [...active.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => ({ name, count }));
}

export function clearActiveSubagents(): void {
  active.clear();
}
