import { emptyUsage, type Message, type Response, type ToolDef } from "../api/types.ts";
import type { Provider, SendContext } from "./provider.ts";

/**
 * Canned provider for the agent loop. No network. Records each send so tests
 * can assert on the history the loop built.
 */
export class MockProvider implements Provider {
  responses: Response[];
  /** After the canned list is exhausted, repeat the last response. */
  repeatLast = false;
  /** When set, every send rejects with this value and ignores responses. */
  err: unknown = null;
  modelName = "";

  private sent: Message[][] = [];
  private sentTools: ToolDef[][] = [];
  private sentSystems: Array<string | undefined> = [];
  private callCount = 0;

  constructor(responses: Response[] = []) {
    this.responses = responses;
  }

  async send(messages: Message[], tools: ToolDef[], _ctx?: SendContext): Promise<Response> {
    if (this.err != null) {
      this.callCount++;
      throw this.err;
    }

    this.sent.push(messages.map((message) => ({ ...message, content: message.content.map((block) => ({ ...block })) })));
    this.sentTools.push(tools.slice());
    this.sentSystems.push(_ctx?.system);

    let response: Response;
    if (this.callCount < this.responses.length) {
      response = this.responses[this.callCount];
    } else if (this.repeatLast && this.responses.length > 0) {
      response = this.responses[this.responses.length - 1];
    } else {
      response = { stopReason: "end_turn", content: [], usage: emptyUsage() };
    }
    this.callCount++;
    return response;
  }

  model(): string {
    return this.modelName === "" ? "mock" : this.modelName;
  }

  setModel(name: string): void {
    this.modelName = name;
  }

  calls(): number {
    return this.callCount;
  }

  sentAt(index: number): Message[] | undefined {
    return this.sent[index];
  }

  lastSent(): Message[] | undefined {
    return this.sent.at(-1);
  }

  toolsAt(index: number): ToolDef[] | undefined {
    return this.sentTools[index];
  }

  systemAt(index: number): string | undefined {
    return this.sentSystems[index];
  }
}
