import {
  buildSystemPrompt,
  buildUserPayload,
  OUTPUT_SCHEMA,
  parseOutput,
} from '../core/prompt/build';
import { fetchJson, isRecord, modelIds } from './http';
import {
  ProviderError,
  type ProviderConfig,
  type TranslationProvider,
} from './types';

export function createOpenAIProvider(
  cfg: ProviderConfig,
  deps: { fetch?: typeof fetch } = {},
): TranslationProvider {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const base = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(
    /\/+$/u,
    '',
  );
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  return {
    id: 'openai',
    async translateBatch(req) {
      const effort =
        cfg.model === 'gpt-6.1-sol'
          ? 'low'
          : [
                'gpt-6-sol',
                'gpt-6.1-terra',
                'gpt-6-luna',
                'gpt-5.6-terra',
                'gpt-5.6-luna',
              ].includes(cfg.model)
            ? 'none'
            : undefined;
      const data = await fetchJson(fetcher, `${base}/responses`, {
        method: 'POST',
        headers,
        signal: req.signal,
        body: JSON.stringify({
          model: cfg.model,
          store: false,
          instructions: buildSystemPrompt(req.targetLang),
          input: buildUserPayload(req),
          ...(effort ? { reasoning: { effort } } : {}),
          text: {
            format: {
              type: 'json_schema',
              name: 'translations',
              strict: true,
              schema: OUTPUT_SCHEMA,
            },
          },
        }),
      });
      if (
        !isRecord(data) ||
        !Array.isArray(data.output) ||
        (data.status !== undefined && data.status !== 'completed')
      )
        throw new ProviderError('invalid_response');
      let raw = '';
      for (const output of data.output) {
        if (!isRecord(output)) throw new ProviderError('invalid_response');
        if (output.type !== 'message') continue;
        if (!Array.isArray(output.content))
          throw new ProviderError('invalid_response');
        for (const part of output.content) {
          if (!isRecord(part)) throw new ProviderError('invalid_response');
          if (part.type === 'refusal')
            throw new ProviderError(
              'bad_request',
              'Provider refused translation',
            );
          if (part.type === 'output_text' && typeof part.text === 'string')
            raw += part.text;
        }
      }
      const items = parseOutput(
        raw,
        req.items.map((item) => item.id),
      );
      const usage =
        isRecord(data.usage) &&
        typeof data.usage.input_tokens === 'number' &&
        typeof data.usage.output_tokens === 'number'
          ? {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
            }
          : undefined;
      return { items, ...(usage ? { usage } : {}) };
    },
    async listModels() {
      const data = await fetchJson(fetcher, `${base}/models`, { headers });
      if (!isRecord(data)) throw new ProviderError('invalid_response');
      return modelIds(data.data);
    },
  };
}
