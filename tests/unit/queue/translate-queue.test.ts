import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  TranslateQueue,
  type QueueOptions,
} from '../../../src/core/queue/translate-queue';
import {
  ProviderError,
  type TranslateItem,
} from '../../../src/providers/types';
const item = (key: string, priority = 0, tabId = 1, markup = key) => ({
  key,
  priority,
  tabId,
  markup,
});
const echo = async (items: TranslateItem[]) =>
  items.map((i) => ({ ...i, text: `translated:${i.text}` }));
const tick = (ms = 50) => vi.advanceTimersByTimeAsync(ms);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
test('debounces, sorts priority then FIFO, hides cache keys and deduplicates promises', async () => {
  const translate = vi.fn(echo);
  const queue = new TranslateQueue({ translate });
  const low = queue.enqueue(item('low', 0, 1, 'Low'));
  const first = queue.enqueue(item('first', 10, 1, 'First'));
  const second = queue.enqueue(item('second', 10, 1, 'Second'));
  expect(queue.enqueue(item('first', 10, 2, 'Other markup'))).toBe(first);
  await tick(49);
  expect(translate).not.toHaveBeenCalled();
  await tick(1);
  expect(translate.mock.calls[0]![0]).toEqual([
    { id: '0', text: 'First' },
    { id: '1', text: 'Second' },
    { id: '2', text: 'Low' },
  ]);
  await expect(Promise.all([low, first, second])).resolves.toEqual([
    'translated:Low',
    'translated:First',
    'translated:Second',
  ]);
});
test.each([
  { maxBatchItems: 2, maxBatchTokens: 2500 },
  { maxBatchItems: 40, maxBatchTokens: 2 },
])('enforces item and token batch limits %o', async (limits) => {
  const translate = vi.fn(echo);
  const queue = new TranslateQueue({ translate, ...limits });
  const promises = ['aaa', 'bbb', 'ccc'].map((key) => queue.enqueue(item(key)));
  await tick();
  await Promise.all(promises);
  expect(translate.mock.calls.map(([batch]) => batch.length)).toEqual([2, 1]);
});
test('sends an oversized item alone without splitting markup', async () => {
  const translate = vi.fn(echo);
  const queue = new TranslateQueue({ translate, maxBatchTokens: 3 });
  const markup = 'x'.repeat(12);
  const large = queue.enqueue(item('large', 0, 1, markup));
  await tick();
  await expect(large).resolves.toBe(`translated:${markup}`);
  expect(translate).toHaveBeenCalledOnce();
  expect(translate.mock.calls[0]![0]).toEqual([{ id: '0', text: markup }]);
});
test('never mixes oversized items with normal items in one batch', async () => {
  const translate = vi.fn(echo);
  const queue = new TranslateQueue({ translate, maxBatchTokens: 3 });
  const largeMarkup = 'L'.repeat(12);
  const normal = queue.enqueue(item('normal', 0, 1, 'abc'));
  const large = queue.enqueue(item('large', 0, 1, largeMarkup));
  await tick();
  await Promise.all([normal, large]);
  expect(
    translate.mock.calls.map(([batch]) => batch.map((i) => i.text)),
  ).toEqual([['abc'], [largeMarkup]]);
});
test('schedules high-priority normal items before a low-priority oversized item', async () => {
  const translate = vi.fn(echo);
  const queue = new TranslateQueue({
    translate,
    maxBatchTokens: 3,
    concurrency: 1,
  });
  const largeMarkup = 'L'.repeat(12);
  const lowLarge = queue.enqueue(item('large', 0, 1, largeMarkup));
  const high = queue.enqueue(item('high', 10, 1, 'abc'));
  await tick();
  await tick();
  await Promise.all([lowLarge, high]);
  expect(translate.mock.calls.map(([batch]) => batch[0]!.text)).toEqual([
    'abc',
    largeMarkup,
  ]);
});
test('enforces concurrency and deduplicates in-flight requests', async () => {
  const complete: ((items: TranslateItem[]) => void)[] = [];
  const translate = vi.fn(
    (items: TranslateItem[]) =>
      new Promise<TranslateItem[]>((resolve) =>
        complete.push(() => resolve(items)),
      ),
  );
  const queue = new TranslateQueue({
    translate,
    concurrency: 2,
    maxBatchItems: 1,
  });
  const promises = ['a', 'b', 'c'].map((key) => queue.enqueue(item(key)));
  await tick();
  expect(translate).toHaveBeenCalledTimes(2);
  expect(queue.enqueue(item('a'))).toBe(promises[0]);
  complete[0]!([]);
  await tick();
  expect(translate).toHaveBeenCalledTimes(3);
  complete[1]!([]);
  complete[2]!([]);
  await Promise.all(promises);
});
test('honors retry-after before retrying 429', async () => {
  const translate = vi
    .fn(echo)
    .mockRejectedValueOnce(
      new ProviderError('rate_limit', 'rate', { retryAfterMs: 1200 }),
    );
  const queue = new TranslateQueue({ translate });
  const result = queue.enqueue(item('hello'));
  await tick();
  expect(translate).toHaveBeenCalledOnce();
  await tick(1199);
  expect(translate).toHaveBeenCalledOnce();
  await tick(1);
  await expect(result).resolves.toBe('translated:hello');
  expect(translate).toHaveBeenCalledTimes(2);
});
test.each(['server', 'network'] as const)(
  'retries %s with exponential jitter and stops at maxAttempts',
  async (kind) => {
    const translate = vi.fn(echo).mockRejectedValue(new ProviderError(kind));
    const sleep = vi.fn(async () => {});
    const queue = new TranslateQueue({ translate, sleep, random: () => 0.5 });
    const rejected = expect(queue.enqueue(item('hello'))).rejects.toMatchObject(
      { kind },
    );
    await tick();
    await rejected;
    expect(translate).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  },
);
test.each(['auth', 'bad_request', 'invalid_response'] as const)(
  'does not retry %s',
  async (kind) => {
    const translate = vi.fn(echo).mockRejectedValue(new ProviderError(kind));
    const queue = new TranslateQueue({ translate });
    const rejected = expect(queue.enqueue(item('hello'))).rejects.toMatchObject(
      { kind },
    );
    await tick();
    await rejected;
    expect(translate).toHaveBeenCalledOnce();
  },
);
test('requeues only missing items with fresh batch IDs', async () => {
  const translate = vi
    .fn(echo)
    .mockResolvedValueOnce([{ id: '1', text: 'second result' }]);
  const queue = new TranslateQueue({ translate });
  const first = queue.enqueue(item('a'));
  const second = queue.enqueue(item('b'));
  await tick();
  await expect(second).resolves.toBe('second result');
  await tick();
  await expect(first).resolves.toBe('translated:a');
  expect(translate.mock.calls[1]![0]).toEqual([{ id: '0', text: 'a' }]);
});
test('missing item retries stop after the configured limit', async () => {
  const translate = vi.fn(echo).mockResolvedValue([]);
  const queue = new TranslateQueue({ translate });
  const rejected = expect(queue.enqueue(item('hello'))).rejects.toMatchObject({
    kind: 'invalid_response',
  });
  await tick(150);
  await rejected;
  expect(translate).toHaveBeenCalledTimes(3);
});
test('rejects unknown or duplicate result IDs immediately', async () => {
  const translate = vi
    .fn(echo)
    .mockResolvedValue([{ id: '9', text: 'unknown' }]);
  const queue = new TranslateQueue({ translate });
  const rejected = expect(queue.enqueue(item('hello'))).rejects.toMatchObject({
    kind: 'invalid_response',
  });
  await tick();
  await rejected;
  expect(translate).toHaveBeenCalledOnce();
});
test('cancelTab rejects pending work but retains a shared key requested by another tab', async () => {
  const translate = vi.fn(echo);
  const queue = new TranslateQueue({ translate });
  const canceled = expect(
    queue.enqueue(item('canceled')),
  ).rejects.toMatchObject({ kind: 'aborted' });
  const shared = queue.enqueue(item('shared'));
  expect(queue.enqueue(item('shared', 0, 2))).toBe(shared);
  queue.cancelTab(1);
  await canceled;
  await tick();
  await expect(shared).resolves.toBe('translated:shared');
  expect(translate.mock.calls[0]![0]).toEqual([{ id: '0', text: 'shared' }]);
});
test('aborts an all-canceled active batch, releases its slot, and allows the same key again', async () => {
  let signal: AbortSignal | undefined;
  const translate = vi.fn((_: TranslateItem[], passed: AbortSignal) => {
    signal = passed;
    return new Promise<TranslateItem[]>(() => {});
  });
  const queue = new TranslateQueue({ translate, concurrency: 1 });
  const canceled = expect(queue.enqueue(item('same'))).rejects.toMatchObject({
    kind: 'aborted',
  });
  await tick();
  queue.cancelTab(1);
  await canceled;
  expect(signal!.aborted).toBe(true);
  translate.mockImplementation(echo);
  const again = queue.enqueue(item('same', 0, 2));
  await tick();
  await expect(again).resolves.toBe('translated:same');
});
test('does not abort mixed-tab active batches and resolves the remaining tab', async () => {
  let resolve!: (items: TranslateItem[]) => void;
  let signal: AbortSignal | undefined;
  const queue = new TranslateQueue({
    translate: (_, passed) => {
      signal = passed;
      return new Promise((yes) => {
        resolve = yes;
      });
    },
  });
  const canceled = expect(queue.enqueue(item('a', 0, 1))).rejects.toMatchObject(
    { kind: 'aborted' },
  );
  const retained = queue.enqueue(item('b', 0, 2));
  await tick();
  queue.cancelTab(1);
  await canceled;
  expect(signal!.aborted).toBe(false);
  resolve([
    { id: '0', text: 'ignored' },
    { id: '1', text: 'retained' },
  ]);
  await expect(retained).resolves.toBe('retained');
});
test('can cancel during backoff without issuing another API request', async () => {
  const translate = vi
    .fn(echo)
    .mockRejectedValueOnce(new ProviderError('server'));
  const queue = new TranslateQueue({ translate });
  const canceled = expect(queue.enqueue(item('a'))).rejects.toMatchObject({
    kind: 'aborted',
  });
  await tick();
  queue.cancelTab(1);
  await canceled;
  await tick(10000);
  expect(translate).toHaveBeenCalledOnce();
});
test.each([
  { concurrency: 0 },
  { maxAttempts: 0 },
  { maxBatchTokens: 0 },
  { maxMissingRetries: -1 },
  { debounceMs: NaN },
])('rejects invalid queue config %o', (options) => {
  expect(
    () => new TranslateQueue({ translate: echo, ...options } as QueueOptions),
  ).toThrow(RangeError);
});

test('a malformed injected result fails as invalid_response without retrying', async () => {
  const translate = vi
    .fn(echo)
    .mockResolvedValue(null as unknown as TranslateItem[]);
  const queue = new TranslateQueue({ translate });
  const rejected = expect(queue.enqueue(item('hello'))).rejects.toMatchObject({
    kind: 'invalid_response',
  });
  await tick();
  await rejected;
  expect(translate).toHaveBeenCalledOnce();
});
