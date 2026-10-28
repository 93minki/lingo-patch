import Anthropic from '@anthropic-ai/sdk';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  buildUserPayload,
  OUTPUT_SCHEMA,
  parseOutput,
} from '../core/prompt/build';
import { httpError, isRecord } from './http';
import {
  ProviderError,
  type ProviderConfig,
  type TranslationProvider,
} from './types';

function mapSdkError(error: unknown): ProviderError {
  if (error instanceof APIUserAbortError) return new ProviderError('aborted');
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  )
    return new ProviderError('auth', undefined, { status: error.status });
  if (error instanceof RateLimitError)
    return httpError(429, error.headers?.get('retry-after'));
  if (error instanceof InternalServerError)
    return new ProviderError('server', undefined, { status: error.status });
  if (
    error instanceof APIConnectionError ||
    error instanceof APIConnectionTimeoutError
  )
    return new ProviderError('network');
  if (error instanceof BadRequestError)
    return new ProviderError('bad_request', undefined, { status: 400 });
  if (error instanceof APIError)
    return httpError(
      error.status ?? 400,
      error.headers?.get('retry-after') ?? null,
    );
  if (error instanceof SyntaxError)
    return new ProviderError('invalid_response');
  if (error instanceof TypeError) return new ProviderError('invalid_response');
  return new ProviderError('invalid_response');
}

function assertMessage(message: unknown, expectedModel: string): void {
  if (!isRecord(message)) throw new ProviderError('invalid_response');
  if (message.model !== expectedModel)
    throw new ProviderError('invalid_response');
  if (!Array.isArray(message.content))
    throw new ProviderError('invalid_response');
  for (const block of message.content) {
    if (
      !isRecord(block) ||
      block.type !== 'text' ||
      typeof block.text !== 'string'
    )
      throw new ProviderError('invalid_response');
  }
}

export function createAnthropicProvider(
  cfg: ProviderConfig,
  deps: { fetch?: typeof fetch } = {},
): TranslationProvider {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    fetch: fetcher,
  });
  return {
    id: 'anthropic',
    async translateBatch(req) {
      try {
        const message = await client.messages.create(
          {
            model: cfg.model,
            max_tokens: 8192,
            system: buildSystemPrompt(req.targetLang),
            messages: [{ role: 'user', content: buildUserPayload(req) }],
            output_config: {
              effort: 'low',
              format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
            },
          },
          { signal: req.signal },
        );
        assertMessage(message, cfg.model);
        if (message.stop_reason === 'refusal')
          throw new ProviderError('bad_request');
        let raw = '';
        for (const block of message.content) {
          if (block.type === 'text') raw += block.text;
        }
        const items = parseOutput(
          raw,
          req.items.map((item) => item.id),
        );
        const usage = message.usage
          ? {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            }
          : undefined;
        return { items, ...(usage ? { usage } : {}) };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw mapSdkError(error);
      }
    },
    async listModels() {
      try {
        const ids: string[] = [];
        for await (const model of client.models.list()) {
          if (typeof model.id !== 'string')
            throw new ProviderError('invalid_response');
          ids.push(model.id);
        }
        return ids;
      } catch (error) {
        throw mapSdkError(error);
      }
    },
  };
}
