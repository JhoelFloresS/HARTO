export type Decision = "ask" | "allow" | "deny";

export interface PolicyDecision {
  decision: Decision;
  reason: string;
}

export interface PermissionPolicy {
  decide(name: string, input: string): PolicyDecision;
}

/** Names in the set run without asking. Every other name asks. */
export class AllowList implements PermissionPolicy {
  private names: Set<string>;

  constructor(names: string[]) {
    this.names = new Set(names);
  }

  decide(name: string): PolicyDecision {
    if (this.names.has(name)) return { decision: "allow", reason: "" };
    return { decision: "ask", reason: "" };
  }
}

export const readOnlyTools = ["read_file", "recall", "search"];
