import type { Settings } from '@shared/types';
import { PROVIDER_DEFAULTS } from '@shared/types';
import { getApiKey } from '../settings';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { OpenAICompatibleProvider } from './openai';
import type { LLMProvider } from './types';
import { ProviderError } from './types';

export function createProvider(settings: Settings): LLMProvider {
  const baseUrl = settings.baseUrl || PROVIDER_DEFAULTS[settings.provider].baseUrl;
  const model = settings.model || PROVIDER_DEFAULTS[settings.provider].model;
  const key = getApiKey(settings.provider);
  if (PROVIDER_DEFAULTS[settings.provider].needsKey && !key) {
    throw new ProviderError(`No API key set for ${PROVIDER_DEFAULTS[settings.provider].label}. Open Settings to add one.`);
  }
  switch (settings.provider) {
    case 'ollama-cloud':
    case 'ollama-local':
      return new OllamaProvider(baseUrl, model, key);
    case 'anthropic':
      return new AnthropicProvider(baseUrl, model, key);
    case 'openai-compatible':
      return new OpenAICompatibleProvider(baseUrl, model, key);
  }
}
