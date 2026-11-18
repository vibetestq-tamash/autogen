import type { ChatMessage, ChatRequest, ChatResponse, LLMProvider, ToolCall } from './types';
import { ProviderError } from './types';

/**
 * Ollama chat API. Works for both Ollama Cloud (https://ollama.com, Bearer API key)
 * and a local Ollama server (http://localhost:11434, no key) - same wire format.
 */
export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly allowsHistoryTrim = true;

  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey?: string
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.model,
      stream: false,
      options: { temperature: req.temperature },
      messages: [{ role: 'system', content: req.system }, ...req.messages.map(toOllama)],
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }))
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: req.signal
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ProviderError(`Cannot reach ${this.baseUrl}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError('Ollama rejected the API key (401/403). Check the key in Settings.', res.status);
      }
      if (res.status === 404) {
        throw new ProviderError(`Model "${this.model}" not found on ${this.baseUrl}. ${text}`, res.status);
      }
      throw new ProviderError(`Ollama error ${res.status}: ${text.slice(0, 500)}`, res.status);
    }
    const data = (await res.json()) as {
      message?: { content?: string; tool_calls?: { id?: string; function: { name: string; arguments: unknown } }[] };
    };
    const msg = data.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc, i) => ({
      id: tc.id || `call_${Date.now()}_${i}`,
      name: tc.function.name,
      args: parseArgs(tc.function.arguments)
    }));
    return { content: stripThinkTags(msg.content ?? ''), toolCalls };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(`Could not list models (${res.status})`, res.status);
    const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
    return (data.models ?? []).map((m) => m.name || m.model || '').filter(Boolean).sort();
  }
}

function toOllama(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.name };
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content,
      ...(m.toolCalls?.length
        ? { tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.args } })) }
        : {})
    };
  }
  return { role: 'user', content: m.content };
}

export function parseArgs(a: unknown): Record<string, unknown> {
  if (a && typeof a === 'object') return a as Record<string, unknown>;
  if (typeof a === 'string') {
    try {
      const parsed = JSON.parse(a);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Some reasoning models put their reasoning inline in <think> tags. */
export function stripThinkTags(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
