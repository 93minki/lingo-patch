import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createOpenAIProvider } from '../../../src/providers/openai';
import { httpError } from '../../../src/providers/http';
import type { TranslateRequest } from '../../../src/providers/types';
const req: TranslateRequest = {
  items: [{ id: '0', text: 'Hello <x0/>' }],
  targetLang: 'ko',
  glossary: [],
};
const cfg = {
  provider: 'openai' as const,
  model: 'gpt-6.1-sol',
  apiKey: 'test-key',
};
const success = (raw = '{"items":[{"id":"0","text":"안녕 <x0/>"}]}') => ({
  status: 'completed',
  output: [
    { type: 'reasoning' },
    { type: 'message', content: [{ type: 'output_text', text: raw }] },
  ],
  usage: { input_tokens: 10, output_tokens: 20 },
});
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected live fetch');
    }),
  ),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test('uses Responses JSON schema with correct auth, low effort and no storage', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(success()));
  const result = await createOpenAIProvider(cfg, {
    fetch: fetcher,
  }).translateBatch(req);
  expect(result).toEqual({
    items: [{ id: '0', text: '안녕 <x0/>' }],
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(init!.headers).toMatchObject({
    Authorization: 'Bearer test-key',
    'Content-Type': 'application/json',
  });
  const body = JSON.parse(init!.body as string);
  expect(body).toMatchObject({
    model: cfg.model,
    store: false,
    reasoning: { effort: 'low' },
    text: {
      format: {
        type: 'json_schema',
        name: 'translations',
        strict: true,
        schema: { additionalProperties: false },
      },
    },
  });
  expect(JSON.parse(body.input).items).toEqual(req.items);
  expect(body.temperature).toBeUndefined();
});
test.each([
  'gpt-6-sol',
  'gpt-6.1-terra',
  'gpt-6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
])('%s uses minimum supported effort none', async (model) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(success()));
  await createOpenAIProvider(
    { ...cfg, model },
    { fetch: fetcher },
  ).translateBatch(req);
  expect(
    JSON.parse(fetcher.mock.calls[0]![1]!.body as string).reasoning.effort,
  ).toBe('none');
});
test.each(['unverified-model', 'constructor', '__proto__'])(
  'does not guess effort for unverified model ID %s',
  async (model) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(success()));
    await createOpenAIProvider(
      { ...cfg, model },
      { fetch: fetcher },
    ).translateBatch(req);
    expect(
      JSON.parse(fetcher.mock.calls[0]![1]!.body as string).reasoning,
    ).toBeUndefined();
  },
);
test.each([
  [401, 'auth'],
  [403, 'auth'],
  [429, 'rate_limit'],
  [500, 'server'],
  [422, 'bad_request'],
])('classifies HTTP %s', async (status, kind) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response('untrusted body', {
      status: Number(status),
      headers: { 'retry-after': '2.5' },
    }),
  );
  await expect(
    createOpenAIProvider(cfg, { fetch: fetcher }).translateBatch(req),
  ).rejects.toMatchObject({ kind, status, retryAfterMs: 2500 });
  expect(fetcher).toHaveBeenCalledOnce();
});
test('classifies fetch failure and abort without exposing raw errors', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error('secret body'));
  await expect(
    createOpenAIProvider(cfg, { fetch: fetcher }).translateBatch(req),
  ).rejects.toMatchObject({
    kind: 'network',
    message: 'Translation request failed',
  });
  const controller = new AbortController();
  controller.abort();
  fetcher.mockClear();
  await expect(
    createOpenAIProvider(cfg, { fetch: fetcher }).translateBatch({
      ...req,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ kind: 'aborted' });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRejectedValue(new DOMException('aborted', 'AbortError'));
  await expect(
    createOpenAIProvider(cfg, { fetch: fetcher }).translateBatch(req),
  ).rejects.toMatchObject({ kind: 'aborted' });
});
test('parses retry-after HTTP dates and ignores malformed dates', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T00:00:00Z'));
  expect(httpError(429, 'Wed, 28 Oct 2026 00:00:03 GMT').retryAfterMs).toBe(
    3000,
  );
  expect(httpError(429, 'nonsense').retryAfterMs).toBeUndefined();
});
test('permits missing IDs but rejects unexpected IDs and malformed response JSON', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(success('{"items":[]}')))
    .mockResolvedValueOnce(
      Response.json(success('{"items":[{"id":"unknown","text":"x"}]}')),
    )
    .mockResolvedValueOnce(new Response('broken'));
  const provider = createOpenAIProvider(cfg, { fetch: fetcher });
  expect((await provider.translateBatch(req)).items).toEqual([]);
  await expect(provider.translateBatch(req)).rejects.toMatchObject({
    kind: 'invalid_response',
  });
  await expect(provider.translateBatch(req)).rejects.toMatchObject({
    kind: 'invalid_response',
  });
});
test('rejects refusal and incomplete response', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        output: [{ type: 'message', content: [{ type: 'refusal' }] }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ ...success(), status: 'incomplete' }),
    );
  const provider = createOpenAIProvider(cfg, { fetch: fetcher });
  await expect(provider.translateBatch(req)).rejects.toMatchObject({
    kind: 'bad_request',
  });
  await expect(provider.translateBatch(req)).rejects.toMatchObject({
    kind: 'invalid_response',
  });
});
test('listModels validates IDs and uses same authenticated fetch', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: [{ id: cfg.model }] }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: 4 }] }));
  const provider = createOpenAIProvider(cfg, { fetch: fetcher });
  expect(await provider.listModels()).toEqual([cfg.model]);
  expect(fetcher.mock.calls[0]![0]).toBe('https://api.openai.com/v1/models');
  await expect(provider.listModels()).rejects.toMatchObject({
    kind: 'invalid_response',
  });
});

test('classifies body transport failure as network and body abort as aborted', async () => {
  const response = Response.json(success());
  vi.spyOn(response, 'json').mockRejectedValue(
    new TypeError('body read failed'),
  );
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const provider = createOpenAIProvider(cfg, { fetch: fetcher });
  await expect(provider.translateBatch(req)).rejects.toMatchObject({
    kind: 'network',
  });
  vi.mocked(response.json).mockRejectedValue(
    new DOMException('stop', 'AbortError'),
  );
  await expect(provider.translateBatch(req)).rejects.toMatchObject({
    kind: 'aborted',
  });
});
