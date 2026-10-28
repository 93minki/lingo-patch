import {
  buildSystemPrompt,
  buildUserPayload,
  OUTPUT_SCHEMA,
  parseOutput,
} from '../core/prompt/build';
import { fetchJson, isRecord } from './http';
import {
  ProviderError,
  type ProviderConfig,
  type TranslationProvider,
} from './types';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function modelResource(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`;
}

function geminiId(name: string): string {
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

export function createGeminiProvider(
  cfg: ProviderConfig,
  deps: { fetch?: typeof fetch } = {},
): TranslationProvider {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const base = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/+$/u, '');
  const headers = {
    'Content-Type': 'application/json',
    'x-goog-api-key': cfg.apiKey,
  };
  return {
    id: 'gemini',
    async translateBatch(req) {
      const url = `${base}/${modelResource(cfg.model)}:generateContent`;
      const data = await fetchJson(fetcher, url, {
        method: 'POST',
        headers,
        signal: req.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: buildSystemPrompt(req.targetLang) }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: buildUserPayload(req) }],
            },
          ],
          generationConfig: {
            responseFormat: {
              text: {
                mimeType: 'APPLICATION_JSON',
                schema: OUTPUT_SCHEMA,
              },
            },
          },
        }),
      });
      if (!isRecord(data) || !Array.isArray(data.candidates))
        throw new ProviderError('invalid_response');
      const candidate = data.candidates[0];
      if (!isRecord(candidate)) throw new ProviderError('invalid_response');
      const content = candidate.content;
      if (!isRecord(content) || !Array.isArray(content.parts))
        throw new ProviderError('invalid_response');
      let raw = '';
      for (const part of content.parts) {
        if (isRecord(part) && typeof part.text === 'string') raw += part.text;
      }
      const items = parseOutput(
        raw,
        req.items.map((item) => item.id),
      );
      const meta = data.usageMetadata;
      const usage =
        isRecord(meta) &&
        typeof meta.promptTokenCount === 'number' &&
        typeof meta.candidatesTokenCount === 'number'
          ? {
              inputTokens: meta.promptTokenCount,
              outputTokens: meta.candidatesTokenCount,
            }
          : undefined;
      return { items, ...(usage ? { usage } : {}) };
    },
    async listModels() {
      const ids: string[] = [];
      let pageToken: string | undefined;
      const seenPageTokens = new Set<string>();
      do {
        const query = new URLSearchParams({ pageSize: '100' });
        if (pageToken) query.set('pageToken', pageToken);
        const data = await fetchJson(fetcher, `${base}/models?${query}`, {
          headers,
        });
        if (!isRecord(data) || !Array.isArray(data.models))
          throw new ProviderError('invalid_response');
        for (const model of data.models) {
          if (!isRecord(model) || typeof model.name !== 'string')
            throw new ProviderError('invalid_response');
          ids.push(geminiId(model.name));
        }
        const next =
          typeof data.nextPageToken === 'string' &&
          data.nextPageToken.length > 0
            ? data.nextPageToken
            : undefined;
        if (next) {
          if (seenPageTokens.has(next))
            throw new ProviderError('invalid_response');
          seenPageTokens.add(next);
        }
        pageToken = next;
      } while (pageToken);
      return ids;
    },
  };
}
