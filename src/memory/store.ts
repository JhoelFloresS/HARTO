export interface Entry {
  time: Date;
  kind: string;
  content: string;
  tags: string[];
}

export interface Store {
  save(entry: Entry): Promise<void>;
  recall(query: string, limit: number): Promise<Entry[]>;
  preamble(): Promise<string>;
}

/** Succeeds and returns nothing. The tools stay usable when the directory cannot be created. */
export class NoMemory implements Store {
  async save(): Promise<void> {}

  async recall(): Promise<Entry[]> {
    return [];
  }

  async preamble(): Promise<string> {
    return "";
  }
}

let current: Store = new NoMemory();

export function getMemoryStore(): Store {
  return current;
}

export function setMemoryStore(store: Store): void {
  current = store;
}
