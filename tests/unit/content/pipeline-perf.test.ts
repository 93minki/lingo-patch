import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BackgroundMessage,
  PageMessage,
} from '../../../src/messaging/types';
import * as segment from '../../../src/core/segment';

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

let messages: PageMessage[];
let receive: (message: BackgroundMessage) => void;
let intersection: (entries: IntersectionObserverEntry[]) => void;
let dispose: (() => void) | undefined;

const mode = (): Extract<BackgroundMessage, { type: 'mode' }> => ({
  type: 'mode',
  generation: 0,
  displayMode: 'bilingual',
  targetLang: 'ko',
  autoEnabled: true,
  revision: 0,
  configured: true,
  skipFixedBars: true,
});

const nextScan = async () => {
  await vi.advanceTimersByTimeAsync(350);
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  messages = [];
  vi.spyOn(segment, 'findSegments');
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: typeof intersection) {
        intersection = cb;
      }
      observe = vi.fn();
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
    onDisconnect: { addListener: vi.fn() },
    disconnect: vi.fn(),
  }));
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('index renders every block that shares the same cache key', async () => {
  document.body.innerHTML =
    '<p>Shared text</p><p>Shared text</p><p>Other text</p>';
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  const generation = messages.at(-1)?.generation ?? 0;
  receive({
    type: 'cached',
    generation,
    keys: ['Shared text', 'Other text'],
    entries: [{ key: 'Shared text', text: '공유 번역' }],
  });
  intersection([
    {
      target: document.querySelectorAll('p')[1]!,
      isIntersecting: true,
      boundingClientRect: { top: 0, bottom: 20 },
    } as unknown as IntersectionObserverEntry,
  ]);
  receive({
    type: 'translated',
    generation,
    key: 'Shared text',
    text: '공유 번역',
  });
  expect(document.querySelectorAll('lp-t')).toHaveLength(2);
  expect(
    [...document.querySelectorAll('lp-t')].every(
      (node) => node.textContent === '공유 번역',
    ),
  ).toBe(true);
});

test('incremental scan looks up only newly added paragraphs', async () => {
  document.body.innerHTML = '<p>First</p><p>Second</p>';
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  vi.mocked(segment.findSegments).mockClear();
  const added = document.createElement('p');
  added.textContent = 'Third';
  document.body.append(added);
  await nextScan();
  const lookup = messages.filter((m) => m.type === 'lookup').at(-1);
  expect(lookup?.keys).toEqual(['Third']);
  expect(vi.mocked(segment.findSegments).mock.calls.length).toBeGreaterThan(0);
  expect(
    vi
      .mocked(segment.findSegments)
      .mock.calls.every(([root]) => root !== document.body),
  ).toBe(true);
});

test('incremental scan replaces records when a paragraph text changes', async () => {
  document.body.innerHTML = '<p>Stable</p>';
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  const paragraph = document.querySelector('p')!;
  paragraph.firstChild!.textContent = 'Changed text';
  await nextScan();
  expect(messages.filter((m) => m.type === 'lookup').at(-1)?.keys).toEqual([
    'Changed text',
  ]);
});

test('throttles rescans of the same block to once per second', async () => {
  document.body.innerHTML = '<p>Tick</p>';
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  vi.mocked(segment.findSegments).mockClear();
  const paragraph = document.querySelector('p')!;
  for (let i = 0; i < 8; i++) {
    paragraph.firstChild!.textContent = `Tick ${i}`;
    await vi.advanceTimersByTimeAsync(100);
  }
  await vi.advanceTimersByTimeAsync(350);
  await Promise.resolve();
  const callsBefore = vi.mocked(segment.findSegments).mock.calls.length;
  await vi.advanceTimersByTimeAsync(700);
  await Promise.resolve();
  const callsAfter = vi.mocked(segment.findSegments).mock.calls.length;
  expect(callsBefore).toBeGreaterThan(0);
  expect(callsAfter).toBe(callsBefore);
});

test('large body-level replacement falls back to a full scan', async () => {
  document.body.innerHTML = '<p>Before</p>';
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  vi.mocked(segment.findSegments).mockClear();
  const main = document.createElement('main');
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('p');
    p.textContent = `Line ${i}`;
    main.append(p);
  }
  document.body.replaceChildren(main);
  await nextScan();
  expect(
    vi
      .mocked(segment.findSegments)
      .mock.calls.some(([root]) => root === document.body),
  ).toBe(true);
});

test('measures full vs incremental scan on a large synthetic page', async () => {
  const parts: string[] = [];
  for (let i = 0; i < 2000; i++) {
    parts.push(`<p>Segment number ${i}</p>`);
  }
  document.body.innerHTML = parts.join('');
  dispose = startPagePipeline();
  receive(mode());
  const fullStart = performance.now();
  await nextScan();
  const fullMs = performance.now() - fullStart;
  vi.mocked(segment.findSegments).mockClear();
  const extra = document.createElement('p');
  extra.textContent = 'Segment number 2000';
  document.body.append(extra);
  const incrementalStart = performance.now();
  await nextScan();
  const incrementalMs = performance.now() - incrementalStart;
  const incrementalCalls = vi.mocked(segment.findSegments).mock.calls.length;
  console.log(
    JSON.stringify({
      fullScanMs: fullMs,
      incrementalScanMs: incrementalMs,
      incrementalFindSegmentsCalls: incrementalCalls,
    }),
  );
  expect(incrementalCalls).toBeGreaterThan(0);
  expect(incrementalCalls).toBeLessThan(2000);
});

test('removed paragraphs drop their records without a body-wide rescan', async () => {
  document.body.innerHTML =
    '<main><section><p>Keep me</p><p>Remove me</p></section></main>';
  dispose = startPagePipeline();
  receive(mode());
  await nextScan();
  const generation = messages.at(-1)!.generation;
  receive({
    type: 'cached',
    entries: [
      { key: 'Keep me', text: '유지' },
      { key: 'Remove me', text: '삭제' },
    ],
    keys: ['Keep me', 'Remove me'],
    generation,
  });
  expect(document.querySelectorAll('lp-t')).toHaveLength(2);
  vi.mocked(segment.findSegments).mockClear();
  document.querySelectorAll('p')[1]!.remove();
  await nextScan();
  const calls = vi.mocked(segment.findSegments).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(([root]) => root !== document.body)).toBe(true);
  const ad = document.createElement('div');
  ad.className = 'ad';
  document.querySelector('main')!.append(ad);
  vi.mocked(segment.findSegments).mockClear();
  await nextScan();
  expect(
    vi
      .mocked(segment.findSegments)
      .mock.calls.every(([root]) => root !== document.body),
  ).toBe(true);
  expect(document.querySelectorAll('lp-t')).toHaveLength(1);
});
