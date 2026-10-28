import { describe, expect, test, vi } from 'vitest';
import { createCompatibleProvider } from '../../../src/providers/openai-compatible';

const FAKE_KEY = 'sk-compat-fake-test-key';
const cfg = {
  provider: 'openai-compatible' as const,
  apiKey: FAKE_KEY,
  model: 'llama3',
  baseUrl: 'https://compat.example/v1/',
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

describe('createCompatibleProvider', () => {
  test('posts to /chat/completions with json_object format', async () => {
    const fetcher = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://compat.example/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${FAKE_KEY}`,
      });
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({ items: [{ id: '1', text: 'ok' }] }),
            },
          },
        ],
      });
    });
    const provider = createCompatibleProvider(cfg, { fetch: fetcher });
    const result = await provider.translateBatch({
      items: [{ id: '1', text: 'Hello' }],
      targetLang: 'ko',
      glossary: [],
    });
    expect(result.items).toEqual([{ id: '1', text: 'ok' }]);
  });

  test('allows missing item ids', async () => {
    const provider = createCompatibleProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ id: '1', text: 'partial' }],
                }),
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
    expect(result.items).toEqual([{ id: '1', text: 'partial' }]);
  });

  test('rejects unknown ids and invalid JSON content', async () => {
    const unknownId = createCompatibleProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    { id: '1', text: 'ok' },
                    { id: 'ghost', text: 'x' },
                  ],
                }),
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

    const badJson = createCompatibleProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          choices: [{ message: { content: 'not-json' } }],
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

  test('omits Authorization when apiKey is empty', async () => {
    const fetcher = vi.fn(async (_input, init) => {
      expect(init?.headers).not.toHaveProperty('Authorization');
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({ items: [{ id: '1', text: 'x' }] }),
            },
          },
        ],
      });
    });
    const provider = createCompatibleProvider(
      { ...cfg, apiKey: '' },
      { fetch: fetcher },
    );
    await provider.translateBatch({
      items: [{ id: '1', text: 'Hello' }],
      targetLang: 'ko',
      glossary: [],
    });
  });

  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [500, 'server'],
  ] as const)('classifies HTTP %i as %s', async (status, kind) => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: FAKE_KEY }, status, {
        'retry-after': status === 429 ? '1' : '',
      }),
    );
    const provider = createCompatibleProvider(cfg, { fetch: fetcher });
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({
      kind,
      ...(status === 429 ? { retryAfterMs: 1000 } : {}),
    });
  });

  test('classifies network failures and abort', async () => {
    const provider = createCompatibleProvider(cfg, {
      fetch: vi.fn(async () => {
        throw new Error('down');
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

  test('listModels paginates with after cursor', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('after=m1'))
        return jsonResponse({ data: [{ id: 'm2' }], has_more: false });
      return jsonResponse({
        data: [{ id: 'm1' }],
        has_more: true,
        last_id: 'm1',
      });
    });
    const provider = createCompatibleProvider(cfg, { fetch: fetcher });
    await expect(provider.listModels()).resolves.toEqual(['m1', 'm2']);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://compat.example/v1/models',
    );
  });

  test('listModels rejects repeated after cursor', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [{ id: 'm1' }],
        has_more: true,
        last_id: 'cursor-a',
      }),
    );
    const provider = createCompatibleProvider(cfg, { fetch: fetcher });
    await expect(provider.listModels()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});
