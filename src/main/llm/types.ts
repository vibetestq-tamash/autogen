// Provider-neutral chat types used by the agent loop.

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCall[];
      /**
       * The provider's own copy of the turn. Some providers (Anthropic) need
       * their exact response content sent back unchanged, e.g. thinking blocks.
       */
      raw?: unknown;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  temperature: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  raw?: unknown;
}

export interface LLMProvider {
  readonly id: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  listModels(): Promise<string[]>;
  /**
   * False when the provider needs the history kept append-only
   * (the agent then never shortens earlier tool results).
   */
  readonly allowsHistoryTrim: boolean;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}
