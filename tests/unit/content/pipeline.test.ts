import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BackgroundMessage,
  PageMessage,
} from '../../../src/messaging/types';
const mock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: { runtime: { connect: mock.connect } },
}));
vi.mock('../../../src/core/cache/key', () => ({
  makeCacheKey: async ({ markup }: { markup: string }) => markup,
}));
import { startPagePipeline } from '../../../src/content/pipeline';
let messages: PageMessage[];
let receive: (message: BackgroundMessage) => void;
let disconnected: () => void;
let intersection: (entries: IntersectionObserverEntry[]) => void;
let observe: ReturnType<typeof vi.fn>;
let dispose: (() => void) | undefined;
const mode = (autoEnabled = true, revision = 0): BackgroundMessage => ({
  type: 'mode',
  generation: 0,
  displayMode: 'bilingual',
  targetLang: 'ko',
  autoEnabled,
  revision,
  configured: true,
});
const nextScan = async () => {
  await vi.advanceTimersByTimeAsync(350);
  await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<p>Source paragraph</p><pre>Excluded source</pre>';
  document.documentElement.removeAttribute('data-lp-mode');
  messages = [];
  observe = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: typeof intersection) {
        intersection = cb;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  mock.connect.mockReset().mockImplementation(() => ({
    postMessage: (message: PageMessage) => messages.push(message),
    onMessage: {
      addListener: (cb: typeof receive) => {
        receive = cb;
      },
    },
    onDisconnect: {
      addListener: (cb: typeof disconnected) => {
        disconnected = cb;
      },
    },
    disconnect: vi.fn(),
  }));
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function inView() {
  intersection([
    {
      target: document.querySelector('p')!,
      isIntersecting: true,
      boundingClientRect: { top: 10, bottom: 30 },
    } as unknown as IntersectionObserverEntry,
  ]);
}
test('waits for enable, looks up first, requests only nearby misses and toggles without changing source', async () => {
  dispose = startPagePipeline();
  receive(mode(false));
  await nextScan();
  expect(messages.filter((m) => m.type === 'lookup')).toHaveLength(0);
  receive(mode());
  await nextScan();
  const generation = messages.at(-1)!.generation;
  expect(messages).toContainEqual({
    type: 'lookup',
    keys: ['Source paragraph'],
    generation,
  });
  expect(observe).not.toHaveBeenCalled();
  receive({
    type: 'cached',
    keys: ['Source paragraph'],
    entries: [],
    generation,
  });
  expect(observe).toHaveBeenCalledWith(document.querySelector('p'));
  inView();
  expect(
    messages
      .filter((m) => m.type === 'translate' || m.type === 'lookup')
      .at(-1),
  ).toMatchObject({
    type: 'translate',
    items: [
      { key: 'Source paragraph', markup: 'Source paragraph', priority: 2 },
    ],
  });
  receive({
    type: 'translated',
    key: 'Source paragraph',
    text: '번역문',
    generation,
  });
  expect(document.querySelector('lp-t')!.textContent).toBe('번역문');
  expect(document.querySelector('p')!.firstChild!.textContent).toBe(
    'Source paragraph',
  );
  receive({ type: 'toggle', generation });
  expect(document.querySelector('lp-t')).toBeNull();
  expect(document.querySelector('p')!.outerHTML).toBe(
    '<p>Source paragraph</p>',
  );
  const off = document.createElement('p');
  off.textContent = 'Added while off';
  document.body.append(off);
  const count = messages.filter(
    (m) => m.type === 'translate' || m.type === 'lookup',
  ).length;
  await nextScan();
  expect(
    messages.filter((m) => m.type === 'translate' || m.type === 'lookup'),
  ).toHaveLength(count);
});
test('identical translations skip lp-t but still count as translated', async () => {
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  const generation = messages.at(-1)!.generation;
  inView();
  receive({
    type: 'translated',
    key: 'Source paragraph',
    text: 'Source paragraph',
    generation,
  });
  expect(document.querySelector('lp-t')).toBeNull();
  expect(messages.filter((m) => m.type === 'status').at(-1)).toMatchObject({
    translated: 1,
    restored: 0,
  });
});
test('cache restoration and removed-node repair make no translation request; source additions debounce', async () => {
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  const generation = messages.at(-1)!.generation;
  receive({
    type: 'cached',
    keys: ['Source paragraph'],
    entries: [{ key: 'Source paragraph', text: '번역문' }],
    generation,
  });
  document.querySelector('lp-t')!.remove();
  await nextScan();
  expect(document.querySelector('lp-t')!.textContent).toBe('번역문');
  expect(messages.filter((m) => m.type === 'translate')).toHaveLength(0);
  const count = messages.filter((m) => m.type === 'lookup').length;
  const added = document.createElement('p');
  added.textContent = 'New paragraph';
  document.body.append(added);
  await vi.advanceTimersByTimeAsync(100);
  expect(messages.filter((m) => m.type === 'lookup')).toHaveLength(count);
  await nextScan();
  expect(
    messages
      .filter((m) => m.type === 'translate' || m.type === 'lookup')
      .at(-1),
  ).toMatchObject({
    type: 'lookup',
    keys: ['Source paragraph', 'New paragraph'],
  });
});
test('SPA reset rejects stale results and reconnect scans again', async () => {
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  const generation = messages.at(-1)!.generation;
  history.pushState({}, '', '/new-route');
  window.dispatchEvent(new Event('popstate'));
  await vi.advanceTimersByTimeAsync(550);
  expect(messages).toContainEqual({
    type: 'reset',
    generation: generation + 1,
  });
  receive({
    type: 'translated',
    key: 'Source paragraph',
    text: 'stale',
    generation,
  });
  expect(document.querySelector('lp-t')).toBeNull();
  disconnected();
  await vi.advanceTimersByTimeAsync(150);
  expect(mock.connect).toHaveBeenCalledTimes(2);
  receive(mode());
  await nextScan();
  expect(messages.at(-1)!.generation).toBeGreaterThan(generation + 1);
  history.replaceState({}, '', '/');
});
