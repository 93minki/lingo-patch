import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deleteDB } from 'idb';
import type { Browser } from 'wxt/browser';
import { openCacheDb, type CacheDb } from '../../../src/storage/cache-db';
import { createPageService } from '../../../src/messaging/service';
import { makeCacheKey } from '../../../src/core/cache/key';
import { PROMPT_VERSION } from '../../../src/core/prompt/version';
import type { BackgroundMessage } from '../../../src/messaging/types';
import type { Settings } from '../../../src/storage/settings';
import type { TranslateRequest } from '../../../src/providers/types';
const mock = vi.hoisted(() => ({ translate: vi.fn() }));
vi.mock('../../../src/providers', async (original) => ({
  ...(await original<typeof import('../../../src/providers')>()),
  createProvider: vi.fn(() => ({ translateBatch: mock.translate })),
}));
const settings: Settings = {
  provider: {
    provider: 'openai-compatible',
    model: 'test-model',
    apiKey: 'private-fake-key',
  },
  targetLang: 'ko',
  autoSites: ['site.test'],
  displayMode: 'bilingual',
  cache: { ttlDays: 90, maxMB: 20 },
};
function port(tabId: number) {
  const messages: BackgroundMessage[] = [];
  let receive!: (message: unknown) => void;
  let disconnect!: () => void;
  const value = {
    name: 'lp-page',
    sender: { tab: { id: tabId, url: 'https://site.test/a' }, frameId: 0 },
    postMessage: (message: BackgroundMessage) => messages.push(message),
    onMessage: {
      addListener: (cb: typeof receive) => {
        receive = cb;
      },
    },
    onDisconnect: {
      addListener: (cb: () => void) => {
        disconnect = cb;
      },
    },
    disconnect: vi.fn(),
  };
  return {
    value: value as unknown as Browser.runtime.Port,
    messages,
    send: (message: unknown) => receive(message),
    disconnect: () => disconnect(),
  };
}
let db: CacheDb;
let name: string;
let service: ReturnType<typeof createPageService>;
beforeEach(async () => {
  name = `service-${crypto.randomUUID()}`;
  db = await openCacheDb(name);
  mock.translate
    .mockReset()
    .mockImplementation(async (req: TranslateRequest) => ({
      items: req.items.map((item) => ({ ...item, text: `[KO] ${item.text}` })),
    }));
  service = createPageService(db, settings);
});
afterEach(async () => {
  service.close();
  await deleteDB(name);
});
const keyFor = (markup: string) =>
  makeCacheKey({ markup, targetLang: 'ko', promptVersion: PROMPT_VERSION });
test('two tabs share one API request and receive persisted results without provider settings', async () => {
  const a = port(1),
    b = port(2);
  service.connect(a.value);
  service.connect(b.value);
  const markup = 'Hello world';
  const key = await keyFor(markup);
  const message = {
    type: 'translate',
    generation: 0,
    items: [{ key, markup, priority: 2 }],
  };
  a.send(message);
  b.send(message);
  await vi.waitFor(() => {
    expect(a.messages).toContainEqual({
      type: 'translated',
      generation: 0,
      key,
      text: '[KO] Hello world',
    });
    expect(b.messages).toContainEqual({
      type: 'translated',
      generation: 0,
      key,
      text: '[KO] Hello world',
    });
  });
  expect(mock.translate).toHaveBeenCalledOnce();
  expect(await db.usage()).toMatchObject({ count: 1 });
  expect(JSON.stringify([...a.messages, ...b.messages])).not.toContain(
    'private-fake-key',
  );
  expect(JSON.stringify(a.messages)).not.toContain('provider');
});
test('prefetches previous page keys and restores cache without invoking a provider', async () => {
  const key = await keyFor('Hello');
  await db.putMany([
    { key, value: { translated: '안녕', model: 'test', provider: 'test' } },
  ]);
  await db.putPage('https://site.test/a', [key]);
  const a = port(1);
  service.connect(a.value);
  a.send({
    type: 'page',
    generation: 0,
    pageId: 'https://site.test/a',
    keys: [],
    prefetch: true,
  });
  await vi.waitFor(() =>
    expect(a.messages).toContainEqual({
      type: 'cached',
      generation: 0,
      keys: [key],
      entries: [{ key, text: '안녕' }],
      prefetch: true,
    }),
  );
  expect(mock.translate).not.toHaveBeenCalled();
});
test('rejects spoofed keys and ignores malformed messages without network calls', async () => {
  const a = port(1);
  service.connect(a.value);
  a.send({
    type: 'translate',
    generation: 0,
    items: [{ key: 'a'.repeat(32), markup: 'Wrong key', priority: 2 }],
  });
  a.send({
    type: 'translate',
    generation: 0,
    items: [{ key: 'invalid', markup: 'text', priority: 2 }],
  });
  await vi.waitFor(() =>
    expect(a.messages).toContainEqual({
      type: 'failed',
      generation: 0,
      key: 'a'.repeat(32),
      kind: 'bad_request',
    }),
  );
  expect(mock.translate).not.toHaveBeenCalled();
});
test('reset cancels active requests and suppresses replies from old generations', async () => {
  let signal: AbortSignal | undefined;
  mock.translate.mockImplementation((req: TranslateRequest) => {
    signal = req.signal;
    return new Promise(() => {});
  });
  const a = port(1);
  service.connect(a.value);
  const markup = 'Pending translation';
  const key = await keyFor(markup);
  a.send({
    type: 'translate',
    generation: 0,
    items: [{ key, markup, priority: 2 }],
  });
  await vi.waitFor(() => expect(mock.translate).toHaveBeenCalledOnce());
  a.send({ type: 'reset', generation: 1 });
  expect(signal!.aborted).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    a.messages.filter((m) => m.type === 'failed' || m.type === 'translated'),
  ).toHaveLength(0);
});
test('settings changes send only safe state and disconnect cancels outstanding work', async () => {
  let signal: AbortSignal | undefined;
  mock.translate.mockImplementation((req: TranslateRequest) => {
    signal = req.signal;
    return new Promise(() => {});
  });
  const a = port(1);
  service.connect(a.value);
  const markup = 'Pending translation';
  const key = await keyFor(markup);
  a.send({
    type: 'translate',
    generation: 0,
    items: [{ key, markup, priority: 2 }],
  });
  await vi.waitFor(() => expect(mock.translate).toHaveBeenCalledOnce());
  a.disconnect();
  expect(signal!.aborted).toBe(true);
  service.update({ ...settings, targetLang: 'ja' });
  expect(JSON.stringify(a.messages)).not.toContain('private-fake-key');
});
