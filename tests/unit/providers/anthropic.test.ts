import { describe, expect, test, vi } from 'vitest';

const anthropicClientOptions = vi.hoisted(
  () => [] as Record<string, unknown>[],
);

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class AnthropicWithCapturedOptions extends sdk.default {
    constructor(options: ConstructorParameters<typeof sdk.default>[0]) {
      anthropicClientOptions.push(options as Record<string, unknown>);
      super(options);
    }
  }
  return { ...sdk, default: AnthropicWithCapturedOptions };
});

import { APIConnectionError } from '@anthropic-ai/sdk';
import { createAnthropicProvider } from '../../../src/providers/anthropic';
import { ProviderError } from '../../../src/providers/types';

const FAKE_KEY = 'sk-ant-fake-test-key-not-real';
const cfg = {
  provider: 'anthropic' as const,
  apiKey: FAKE_KEY,
  model: 'claude-sonnet-5-5',
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

function messageBody(items: { id: string; text: string }[]) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: cfg.model,
    content: [{ type: 'text', text: JSON.stringify({ items }) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 11, output_tokens: 13 },
  };
}

describe('createAnthropicProvider', () => {
  test('configures browser client with injected fetch and no retries', async () => {
    anthropicClientOptions.length = 0;
    const fetcher = vi.fn(async () =>
      jsonResponse(messageBody([{ id: '1', text: 'ok' }])),
    );
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    await provider.translateBatch({
      items: [{ id: '1', text: 'Hi' }],
      targetLang: 'ko',
      glossary: [],
    });
    expect(anthropicClientOptions[0]).toMatchObject({
      apiKey: FAKE_KEY,
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
      fetch: fetcher,
    });
  });

  test('does not call global fetch when a mock fetch is injected', async () => {
    const realFetch = globalThis.fetch;
    const globalSpy = vi.fn(() => {
      throw new Error('real network');
    });
    globalThis.fetch = globalSpy as typeof fetch;
    const fetcher = vi.fn(async () =>
      jsonResponse(messageBody([{ id: '1', text: 'ok' }])),
    );
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    await provider.translateBatch({
      items: [{ id: '1', text: 'Hi' }],
      targetLang: 'ko',
      glossary: [],
    });
    expect(globalSpy).not.toHaveBeenCalled();
    globalThis.fetch = realFetch;
  });

  test('parses a successful translation response', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(messageBody([{ id: '1', text: '번역' }])),
    );
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    const result = await provider.translateBatch({
      items: [{ id: '1', text: 'Hello' }],
      targetLang: 'ko',
      glossary: [],
    });
    expect(result.items).toEqual([{ id: '1', text: '번역' }]);
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 13 });
  });

  test('allows missing item ids in the model output', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(messageBody([{ id: '1', text: 'a' }])),
    );
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    const result = await provider.translateBatch({
      items: [
        { id: '1', text: 'x' },
        { id: '2', text: 'y' },
      ],
      targetLang: 'ko',
      glossary: [],
    });
    expect(result.items).toEqual([{ id: '1', text: 'a' }]);
  });

  test('rejects unknown item ids and invalid JSON output', async () => {
    const provider = createAnthropicProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse(
          messageBody([
            { id: '1', text: 'ok' },
            { id: 'unknown', text: 'no' },
          ]),
        ),
      ),
    });
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });

    const badJson = createAnthropicProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          ...messageBody([]),
          content: [{ type: 'text', text: 'not-json' }],
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

  test('rejects wrong model id or malformed content blocks', async () => {
    const wrongModel = createAnthropicProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          ...messageBody([{ id: '1', text: 'x' }]),
          model: 'other-model',
        }),
      ),
    });
    await expect(
      wrongModel.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });

    const badContent = createAnthropicProvider(cfg, {
      fetch: vi.fn(async () =>
        jsonResponse({
          ...messageBody([{ id: '1', text: 'x' }]),
          content: [{ type: 'image', source: {} }],
        }),
      ),
    });
    await expect(
      badContent.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  test('sends structured output config without temperature or thinking', async () => {
    let body: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(messageBody([{ id: '1', text: 'ok' }]));
    });
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    await provider.translateBatch({
      items: [{ id: '1', text: 'Hi' }],
      targetLang: 'ko',
      glossary: [],
    });
    expect(body?.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: expect.any(Object) },
    });
    expect(body?.temperature).toBeUndefined();
    expect(body?.thinking).toBeUndefined();
    const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers;
    const authorization =
      headers instanceof Headers
        ? headers.get('authorization')
        : (headers as Record<string, string> | undefined)?.['authorization'];
    expect(authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [500, 'server'],
  ] as const)('classifies HTTP %i as %s', async (status, kind) => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        { type: 'error', error: { type: 'error', message: FAKE_KEY } },
        status,
        {
          'retry-after': status === 429 ? '2' : '',
        },
      ),
    );
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    try {
      await provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      });
      expect.fail('expected translateBatch to throw');
    } catch (error) {
      expect(error).toMatchObject({
        kind,
        ...(status === 429 ? { retryAfterMs: 2000 } : {}),
      });
      expect(String((error as Error).message)).not.toContain(FAKE_KEY);
    }
  });

  test('classifies APIConnectionError as network', async () => {
    const provider = createAnthropicProvider(cfg, {
      fetch: vi.fn(async () => {
        throw new APIConnectionError({ message: 'connection failed' });
      }),
    });
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  test('classifies abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createAnthropicProvider(cfg, { fetch: vi.fn() });
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  test('listModels aggregates paginated model ids', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/models')) {
        if (!url.includes('after_id='))
          return jsonResponse({
            data: [{ id: 'claude-haiku-5-5', type: 'model' }],
            has_more: true,
            last_id: 'page1',
          });
        return jsonResponse({
          data: [{ id: 'claude-opus-5-5', type: 'model' }],
          has_more: false,
        });
      }
      return jsonResponse(messageBody([{ id: '1', text: 'x' }]));
    });
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    await expect(provider.listModels()).resolves.toEqual([
      'claude-haiku-5-5',
      'claude-opus-5-5',
    ]);
  });

  test('listModels rejects entries without string id', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [{ type: 'model' }],
        has_more: false,
      }),
    );
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    await expect(provider.listModels()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  test('maps refusal stop_reason to bad_request', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        ...messageBody([{ id: '1', text: 'no' }]),
        stop_reason: 'refusal',
      }),
    );
    const provider = createAnthropicProvider(cfg, { fetch: fetcher });
    await expect(
      provider.translateBatch({
        items: [{ id: '1', text: 'Hi' }],
        targetLang: 'ko',
        glossary: [],
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
