import type { ChatMessage, ChatRequest, ChatResponse, LLMProvider } from './types';
import { ProviderError } from './types';
import { parseArgs, stripThinkTags } from './ollama';

/** Any server that speaks the OpenAI Chat Completions format (OpenAI, Groq, LM Studio, vLLM, ...). */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = 'openai-compatible';
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
      temperature: req.temperature,
      messages: [{ role: 'system', content: req.system }, ...req.messages.map(toOpenAI)],
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }))
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
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
      throw new ProviderError(`API error ${res.status}: ${text.slice(0, 500)}`, res.status);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    };
    const msg = data.choices?.[0]?.message ?? {};
    return {
      content: stripThinkTags(msg.content ?? ''),
      toolCalls: (msg.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function.name, args: parseArgs(tc.function.arguments) }))
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(`Could not list models (${res.status})`, res.status);
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).sort();
  }
}

function toOpenAI(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content || null,
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args) }
            }))
          }
        : {})
    };
  }
  return { role: 'user', content: m.content };
}
