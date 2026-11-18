import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ChatRequest, ChatResponse, LLMProvider, ToolCall } from './types';
import { ProviderError } from './types';

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = /^claude-(fable-5-2|fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
/** Older models that reject `output_config.effort`. */
const NO_EFFORT_MODELS = /haiku-4|sonnet-4-5|claude-3/;

/**
 * Claude via the Messages API.
 * Needs an Anthropic API key (console.anthropic.com). Claude.ai subscription
 * OAuth tokens (sk-ant-oat...) are only for Anthropic's own apps and are rejected here.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  /** Claude's thinking blocks are tied to the exact history: keep it append-only. */
  readonly allowsHistoryTrim = false;
  private client: Anthropic;

  constructor(
    baseUrl: string,
    private model: string,
    apiKey?: string
  ) {
    if (!apiKey) throw new ProviderError('No Anthropic API key set. Add one in Settings.');
    if (apiKey.startsWith('sk-ant-oat')) {
      throw new ProviderError(
        'This looks like a Claude.ai subscription token (sk-ant-oat...). Subscription tokens only work in ' +
          "Anthropic's own apps. Create an API key at console.anthropic.com (it starts with sk-ant-api) and use that."
      );
    }
    this.client = new Anthropic({ apiKey, baseURL: baseUrl.replace(/\/+$/, '') || undefined });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const useFallbacks = FALLBACK_MODELS.test(this.model);
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16000,
          system: req.system,
          // Cache the stable prefix (tools + system + earlier turns) across agent steps.
          cache_control: { type: 'ephemeral' },
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema
          })),
          messages: toAnthropic(req.messages),
          ...(NO_EFFORT_MODELS.test(this.model) ? {} : { output_config: { effort: 'high' as const } }),
          // No temperature: the SDK's API version (2026-10-21) rejects sampling parameters on every model.
          ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
        },
        { signal: req.signal }
      );
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (e instanceof Anthropic.AuthenticationError) {
        throw new ProviderError('Anthropic rejected the API key (401). Check the key in Settings.', 401);
      }
      if (e instanceof Anthropic.PermissionDeniedError) {
        throw new ProviderError(`Anthropic: permission denied for model "${this.model}". ${e.message}`, 403);
      }
      if (e instanceof Anthropic.NotFoundError) {
        throw new ProviderError(`Anthropic: model "${this.model}" not found. ${e.message}`, 404);
      }
      if (e instanceof Anthropic.RateLimitError) {
        throw new ProviderError('Anthropic rate limit reached. Wait a moment and try again.', 429);
      }
      if (e instanceof Anthropic.BadRequestError) {
        throw new ProviderError(`Anthropic rejected the request: ${e.message}`, 400);
      }
      if (e instanceof Anthropic.APIError) {
        throw new ProviderError(`Anthropic API error ${e.status ?? ''}: ${e.message}`, e.status);
      }
      if (e instanceof Anthropic.APIConnectionError) {
        throw new ProviderError(`Cannot reach the Anthropic API: ${e.message}`);
      }
      throw e;
    }

    if (response.stop_reason === 'refusal') {
      const d = response.stop_details;
      throw new ProviderError(
        `Claude declined this request${d?.category ? ` (${d.category})` : ''}.${d?.explanation ? ' ' + d.explanation : ''}`
      );
    }

    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> });
      }
    }
    if (response.stop_reason === 'max_tokens' && toolCalls.length === 0) {
      text += '\n\n[Response was cut off at the token limit.]';
    }
    // Keep Claude's own content (thinking, fallback and tool_use blocks) to send back unchanged.
    return { content: text.trim(), toolCalls, raw: response.content };
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }
}

/**
 * Converts the neutral history. Consecutive tool results go into ONE user message,
 * as Claude expects all results of a parallel tool call together.
 */
function toAnthropic(messages: ChatMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  let pendingResults: BetaContentBlockParam[] = [];

  const flush = () => {
    if (pendingResults.length) {
      out.push({ role: 'user', content: pendingResults });
      pendingResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'tool') {
      pendingResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content || '(empty)',
        ...(m.isError ? { is_error: true } : {})
      });
      continue;
    }
    flush();
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (Array.isArray(m.raw)) {
      out.push({ role: 'assistant', content: m.raw as BetaContentBlockParam[] });
    } else {
      // An assistant turn produced by another provider (the user switched mid-chat).
      const blocks: BetaContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    }
  }
  flush();
  return out;
}
