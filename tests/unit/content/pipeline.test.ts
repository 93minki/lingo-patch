import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BackgroundMessage,
  PageMessage,
} from '../../../src/messaging/types';
const mock = vi.hoisted(() => ({ connect: vi.fn(), addListener: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      connect: mock.connect,
      onMessage: {
        addListener: mock.addListener,
        removeListener: vi.fn(),
      },
    },
  },
}));
vi.mock('../../../src/core/cache/key', () => ({
  makeCacheKey: async ({ markup }: { markup: string }) => markup,
}));
import { startPagePipeline } from '../../../src/content/pipeline';
import { SegmentRenderer } from '../../../src/content/renderer';
import { CONTENT_PING } from '../../../src/messaging/content-ping';
let messages: PageMessage[];
let receive: (message: BackgroundMessage) => void;
let disconnected: () => void;
let intersection: (entries: IntersectionObserverEntry[]) => void;
let observe: ReturnType<typeof vi.fn>;
let dispose: (() => void) | undefined;
const mode = (
  autoEnabled = true,
  revision = 0,
): Extract<BackgroundMessage, { type: 'mode' }> => ({
  type: 'mode',
  generation: 0,
  displayMode: 'bilingual',
  targetLang: 'ko',
  autoEnabled,
  revision,
  configured: true,
  skipFixedBars: true,
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
test('selection button ignores input and disabled setting, closes on escape', async () => {
  dispose = startPagePipeline();
  receive(mode(false));
  await nextScan();
  const input = document.createElement('input');
  document.body.append(input);
  input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const host = document.querySelector('lp-selection-overlay')!;
  const button = host.shadowRoot!.querySelector('button')!;
  expect(button.classList.contains('visible')).toBe(false);
  const paragraph = document.querySelector('p')!;
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.getBoundingClientRect = () =>
    ({ left: 0, right: 100, top: 0, bottom: 20 }) as DOMRect;
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  expect(button.classList.contains('visible')).toBe(true);
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  expect(button.classList.contains('visible')).toBe(false);
  receive({ ...mode(false), selectionTranslation: false });
  paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  expect(button.classList.contains('visible')).toBe(false);
  selection.removeAllRanges();
});

test('selection translation still looks up escaped text and displays a response while page translation is off', async () => {
  dispose = startPagePipeline();
  receive(mode(false));
  await nextScan();
  const paragraph = document.querySelector('p')!;
  paragraph.textContent = 'Use <name> & text';
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.getBoundingClientRect = () =>
    ({ left: 0, right: 100, top: 0, bottom: 20 }) as DOMRect;
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const overlay = document.querySelector('lp-selection-overlay')!.shadowRoot!;
  (overlay.querySelector('button') as HTMLButtonElement).click();
  await Promise.resolve();
  const markup = 'Use &lt;name&gt; &amp; text';
  const lookup = messages.find((message) => message.type === 'lookup');
  expect(lookup).toMatchObject({ keys: [markup] });
  receive({
    type: 'cached',
    generation: lookup!.generation,
    keys: [markup],
    entries: [],
  });
  expect(
    messages.filter((message) => message.type === 'translate').at(-1),
  ).toMatchObject({ items: [{ key: markup, markup }] });
  receive({
    type: 'translated',
    generation: lookup!.generation,
    key: markup,
    text: '번역 결과',
  });
  expect(overlay.querySelector('[role=dialog]')!.textContent).toBe('번역 결과');
  expect(paragraph.textContent).toBe('Use <name> & text');
  selection.removeAllRanges();
});
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
  expect(messages.at(-1)!.generation).toBe(generation + 1);
  history.replaceState({}, '', '/');
});

test('manual translation stops after navigating to another page', async () => {
  dispose = startPagePipeline();
  receive(mode(false));
  await vi.advanceTimersByTimeAsync(10);
  receive({ type: 'toggle', generation: messages.at(-1)?.generation ?? 0 });
  await nextScan();
  expect(messages.some((m) => m.type === 'lookup')).toBe(true);
  const lookups = messages.filter((m) => m.type === 'lookup').length;
  history.pushState({}, '', '/other-page');
  window.dispatchEvent(new Event('popstate'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(messages.filter((m) => m.type === 'lookup')).toHaveLength(lookups);
  expect(document.querySelector('lp-t')).toBeNull();
  history.replaceState({}, '', '/');
});

test('hash-only URL changes keep rendered translations', async () => {
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  const generation = messages.at(-1)!.generation;
  receive({
    type: 'cached',
    entries: [{ key: 'Source paragraph', text: '원문 문단' }],
    keys: ['Source paragraph'],
    generation,
  });
  const node = document.querySelector('lp-t');
  expect(node).not.toBeNull();
  const resets = messages.filter((m) => m.type === 'reset').length;
  history.replaceState({}, '', '#section-two');
  window.dispatchEvent(new Event('popstate'));
  await vi.advanceTimersByTimeAsync(550);
  expect(messages.filter((m) => m.type === 'reset')).toHaveLength(resets);
  expect(document.querySelector('lp-t')).toBe(node);
  history.replaceState({}, '', '/');
});

test('reconnect keeps rendered nodes, resynchronizes and retries interrupted requests', async () => {
  document.body.innerHTML = '<p>Source paragraph</p><p>Another paragraph</p>';
  const clear = vi.spyOn(SegmentRenderer.prototype, 'clear');
  dispose = startPagePipeline();
  receive(mode(true, 9));
  await nextScan();
  const generation = messages.at(-1)!.generation;
  receive({
    type: 'cached',
    keys: ['Source paragraph', 'Another paragraph'],
    entries: [{ key: 'Source paragraph', text: '번역문' }],
    generation,
  });
  const node = document.querySelector('lp-t');
  intersection([
    {
      target: document.querySelectorAll('p')[1]!,
      isIntersecting: true,
      boundingClientRect: { top: 10, bottom: 30 },
    } as unknown as IntersectionObserverEntry,
  ]);
  disconnected();
  await vi.advanceTimersByTimeAsync(150);
  messages = [];
  clear.mockClear();
  receive(mode(true, 0));
  expect(clear).not.toHaveBeenCalled();
  expect(document.querySelector('lp-t')).toBe(node);
  expect(messages).toContainEqual({ type: 'reset', generation });
  expect(messages).toContainEqual({
    type: 'lookup',
    keys: ['Source paragraph', 'Another paragraph'],
    generation,
  });
  receive({
    type: 'cached',
    keys: ['Source paragraph', 'Another paragraph'],
    entries: [{ key: 'Source paragraph', text: '번역문' }],
    generation,
  });
  expect(observe).toHaveBeenCalledWith(document.querySelectorAll('p')[1]);
  intersection([
    {
      target: document.querySelectorAll('p')[1]!,
      isIntersecting: true,
      boundingClientRect: { top: 10, bottom: 30 },
    } as unknown as IntersectionObserverEntry,
  ]);
  expect(
    messages.filter((message) => message.type === 'translate').at(-1),
  ).toMatchObject({ items: [{ key: 'Another paragraph' }] });
  clear.mockRestore();
});

test('target language change after reconnect resets, but ping and display changes preserve nodes', async () => {
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
  const node = document.querySelector('lp-t');
  const clear = vi.spyOn(SegmentRenderer.prototype, 'clear');
  const ping = mock.addListener.mock.calls.at(-1)![0];
  const respond = vi.fn();
  ping(CONTENT_PING, {}, respond);
  expect(respond).toHaveBeenCalledWith({ ok: true });
  receive({ ...mode(), displayMode: 'original' });
  expect(document.querySelector('lp-t')).toBe(node);
  expect(clear).not.toHaveBeenCalled();
  expect(document.documentElement.getAttribute('data-lp-mode')).toBe(
    'original',
  );
  disconnected();
  await vi.advanceTimersByTimeAsync(150);
  receive({ ...mode(), targetLang: 'en' });
  expect(clear).toHaveBeenCalledOnce();
  expect(document.querySelector('lp-t')).toBeNull();
  clear.mockRestore();
});

test('provider revision changes keep rendered nodes and refresh lookup', async () => {
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
  const node = document.querySelector('lp-t');
  const clear = vi.spyOn(SegmentRenderer.prototype, 'clear');
  messages = [];
  receive(mode(true, 1));
  expect(clear).not.toHaveBeenCalled();
  expect(document.querySelector('lp-t')).toBe(node);
  expect(messages).toContainEqual({
    type: 'lookup',
    keys: ['Source paragraph'],
    generation,
  });
  clear.mockRestore();
});
