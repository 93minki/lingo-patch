import type { GlossaryEntry } from '../core/glossary/types';
export type ProviderId =
  'openai' | 'anthropic' | 'gemini' | 'openai-compatible';
export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}
export interface TranslateItem {
  id: string;
  text: string;
}
export interface TranslateRequest {
  items: TranslateItem[];
  sourceLang?: string;
  targetLang: string;
  glossary: GlossaryEntry[];
  context?: { pageTitle?: string; section?: string };
  signal?: AbortSignal;
}
export interface TranslateResult {
  items: TranslateItem[];
  usage?: { inputTokens: number; outputTokens: number };
}
export class ProviderError extends Error {
  constructor(
    public kind:
      | 'auth'
      | 'rate_limit'
      | 'server'
      | 'network'
      | 'bad_request'
      | 'invalid_response'
      | 'aborted',
    message = 'Translation request failed',
    options: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
  status?: number;
  retryAfterMs?: number;
}
export interface TranslationProvider {
  id: ProviderId;
  translateBatch(req: TranslateRequest): Promise<TranslateResult>;
  listModels(): Promise<string[]>;
}
