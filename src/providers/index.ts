import { createOpenAIProvider } from './openai';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';
import { createCompatibleProvider } from './openai-compatible';
import {
  ProviderError,
  type ProviderConfig,
  type TranslationProvider,
} from './types';
export * from './types';

export function createProvider(
  cfg: ProviderConfig,
  deps?: { fetch?: typeof fetch },
): TranslationProvider {
  switch (cfg.provider) {
    case 'openai':
      return createOpenAIProvider(cfg, deps);
    case 'anthropic':
      return createAnthropicProvider(cfg, deps);
    case 'gemini':
      return createGeminiProvider(cfg, deps);
    case 'openai-compatible':
      return createCompatibleProvider(cfg, deps);
    default:
      throw new ProviderError('bad_request', 'Unknown translation provider');
  }
}
