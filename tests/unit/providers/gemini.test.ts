import { describe, expect, test, vi } from 'vitest';
import { createGeminiProvider } from '../../../src/providers/gemini';

const FAKE_KEY = 'gemini-fake-test-key-not-real';
const cfg = {
  provider: 'gemini' as const,
  apiKey: FAKE_KEY,
  model: 'gemini-2.5-flash',
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('createGeminiProvider', () => {
  test('parses generateContent JSON and sets responseFormat JSON schema', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.responseFormat).toEqual({
        text: {
          mimeType: 'APPLICATION_JSON',
          schema: expect.objectContaining({
            type: 'object',
            additionalProperties: false,
            required: ['items'],
          }),
        },
      });
      expect(init?.headers).toMatchObject({ 'x-goog-api-key': FAKE_KEY });
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({ items: [{ id: '1', text: '번역' }] }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
      });
    });
    const provider = createGeminiProvider(cfg, { fetch: fetcher });
    const result = await provider.translateBatch({
      items: [{ id: '1', text: 'Hello' }],
      targetLang: 'ko',
      glossary: [],
    });
    expect(result.items).toEqual([{ id: '1', text: '번역' }]);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(':generateContent');
  });

  test('allows missing item ids', async () => {
    const provider = createGeminiProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      items: [{ id: '1', text: 'only' }],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      ),
    });
    const result = await provider.translateBatch({
      items: [
        { id: '1', text: 'a' },
        { id: '2', text: 'b' },
      ],
      targetLang: 'ko',
      glossary: [],
    });
    expect(result.items).toEqual([{ id: '1', text: 'only' }]);
  });

  test('rejects unknown ids and invalid JSON in candidate text', async () => {
    const unknownId = createGeminiProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      items: [
                        { id: '1', text: 'ok' },
                        { id: 'extra', text: 'x' },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      ),
    });
    await expect(
      unknownId.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });

    const badJson = createGeminiProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{not json' }] } }],
        }),
      ),
    });
    await expect(
      badJson.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [500, 'server'],
  ] as const)('classifies HTTP %i as %s', async (status, kind) => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: FAKE_KEY } }, status, {
        'retry-after': status === 429 ? '3' : '',
      }),
    );
    const provider = createGeminiProvider(cfg, { fetch: fetcher });
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({
      kind,
      ...(status === 429 ? { retryAfterMs: 3000 } : {}),
    });
  });

  test('classifies network failures and abort', async () => {
    const provider = createGeminiProvider(cfg, {
      fetch: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({ kind: 'network' });

    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  test('listModels follows nextPageToken pagination', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('pageToken=token-2'))
        return jsonResponse({
          models: [{ name: 'models/gemini-2.5-pro' }],
        });
      return jsonResponse({
        models: [{ name: 'models/gemini-2.5-flash' }],
        nextPageToken: 'token-2',
      });
    });
    const provider = createGeminiProvider(cfg, { fetch: fetcher });
    await expect(provider.listModels()).resolves.toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);
  });

  test('listModels rejects malformed model entries and repeated page tokens', async () => {
    const badEntry = createGeminiProvider(cfg, {
      fetch: vi.fn(async () => jsonResponse({ models: [{}] })),
    });
    await expect(badEntry.listModels()).rejects.toMatchObject({
      kind: 'invalid_response',
    });

    const repeatToken = createGeminiProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          models: [{ name: 'models/gemini-2.5-flash' }],
          nextPageToken: 'same',
        }),
      ),
    });
    await expect(repeatToken.listModels()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  test('invalid generateContent payload throws invalid_response', async () => {
    const provider = createGeminiProvider(cfg, {
      fetch: vi.fn(async () => jsonResponse({ candidates: [] })),
    });
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
