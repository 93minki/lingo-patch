import {
  buildSystemPrompt,
  buildUserPayload,
  parseOutput,
} from '../core/prompt/build';
import { fetchJson, isRecord, modelIds } from './http';
import {
  ProviderError,
  type ProviderConfig,
  type TranslationProvider,
} from './types';

export function createCompatibleProvider(
  cfg: ProviderConfig,
  deps: { fetch?: typeof fetch } = {},
): TranslationProvider {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const base = (cfg.baseUrl ?? 'http://localhost:11434/v1').replace(
    /\/+$/u,
    '',
  );
  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    return headers;
  };
  return {
    id: 'openai-compatible',
    async translateBatch(req) {
      const data = await fetchJson(fetcher, `${base}/chat/completions`, {
        method: 'POST',
        headers: authHeaders(),
        signal: req.signal,
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: buildSystemPrompt(req.targetLang) },
            { role: 'user', content: buildUserPayload(req) },
          ],
          response_format: { type: 'json_object' },
        }),
      });
      if (!isRecord(data) || !Array.isArray(data.choices))
        throw new ProviderError('invalid_response');
      const choice = data.choices[0];
      if (
        !isRecord(choice) ||
        !isRecord(choice.message) ||
        typeof choice.message.content !== 'string'
      )
        throw new ProviderError('invalid_response');
      const items = parseOutput(
        choice.message.content,
        req.items.map((item) => item.id),
      );
      const usage =
        isRecord(data.usage) &&
        typeof data.usage.prompt_tokens === 'number' &&
        typeof data.usage.completion_tokens === 'number'
          ? {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
            }
          : undefined;
      return { items, ...(usage ? { usage } : {}) };
    },
    async listModels() {
      const ids: string[] = [];
      let after: string | undefined;
      const seenCursors = new Set<string>();
      do {
        const query = after ? `?after=${encodeURIComponent(after)}` : '';
        const data = await fetchJson(fetcher, `${base}/models${query}`, {
          headers: authHeaders(),
        });
        if (!isRecord(data) || !Array.isArray(data.data))
          throw new ProviderError('invalid_response');
        const page = modelIds(data.data);
        ids.push(...page);
        const next =
          data.has_more === true && typeof data.last_id === 'string'
            ? data.last_id
            : undefined;
        if (next) {
          if (seenCursors.has(next))
            throw new ProviderError('invalid_response');
          seenCursors.add(next);
        }
        after = next;
      } while (after);
      return ids;
    },
  };
}
