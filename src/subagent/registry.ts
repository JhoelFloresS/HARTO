import type { Provider } from "../provider/provider.ts";

export interface SubagentContext {
  signal?: AbortSignal;
}

export interface Subagent {
  name(): string;
  description(): string;
  run(task: string, ctx?: SubagentContext): Promise<string>;
}

/** Process-wide list. Research registers here once it exists; /provider re-registers through the hook. */
export class SubagentRegistry {
  private items = new Map<string, Subagent>();

  register(subagent: Subagent): void {
    this.items.set(subagent.name(), subagent);
  }

  all(): Subagent[] {
    return [...this.items.values()].sort((left, right) => left.name().localeCompare(right.name()));
  }

  clear(): void {
    this.items.clear();
  }
}

export const subagentRegistry = new SubagentRegistry();

const providerChangeListeners: Array<(provider: Provider) => void> = [];

/** Called after /provider swaps the root provider, so delegates can be rebuilt against it. */
export function onProviderChange(listener: (provider: Provider) => void): void {
  providerChangeListeners.push(listener);
}

export function notifyProviderChange(provider: Provider): void {
  for (const listener of providerChangeListeners) listener(provider);
}
