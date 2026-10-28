import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_TTL_DAYS,
  TOUCH_INTERVAL_MS,
} from '../../../src/core/cache/policy';

const mocks = vi.hoisted(() => ({
  installed: vi.fn(),
  startup: vi.fn(),
  alarm: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  evict: vi.fn(),
  close: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      onInstalled: { addListener: mocks.installed },
      onStartup: { addListener: mocks.startup },
    },
    alarms: {
      get: mocks.get,
      create: mocks.create,
      onAlarm: { addListener: mocks.alarm },
    },
  },
}));
vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (main: () => void) => ({ main }),
}));
vi.mock('../../../src/storage/cache-db', () => ({ openCacheDb: mocks.open }));
import background from '../../../src/entrypoints/background';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue(undefined);
  mocks.evict.mockResolvedValue({ deleted: 0, bytesAfter: 0 });
  mocks.open.mockResolvedValue({ evict: mocks.evict, close: mocks.close });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  background.main();
});
afterEach(() => vi.restoreAllMocks());

test.each(['installed', 'startup'] as const)(
  'registers daily eviction on %s only when missing',
  async (event) => {
    const listener = mocks[event].mock.calls[0]![0];
    await listener();
    expect(mocks.get).toHaveBeenCalledWith('lp-evict');
    expect(mocks.create).toHaveBeenCalledWith('lp-evict', {
      delayInMinutes: 1440,
      periodInMinutes: 1440,
    });
    mocks.create.mockClear();
    mocks.get.mockResolvedValue({ name: 'lp-evict' });
    await listener();
    expect(mocks.create).not.toHaveBeenCalled();
  },
);
test('runs default eviction only for lp-evict and closes the connection', async () => {
  const listener = mocks.alarm.mock.calls[0]![0];
  await listener({ name: 'unrelated' });
  expect(mocks.open).not.toHaveBeenCalled();
  await listener({ name: 'lp-evict' });
  expect(mocks.evict).toHaveBeenCalledWith(expect.any(Number), {
    ttlMs: DEFAULT_TTL_DAYS * TOUCH_INTERVAL_MS,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  expect(mocks.close).toHaveBeenCalledOnce();
});
test('reports eviction failures and still closes the DB', async () => {
  mocks.evict.mockRejectedValueOnce(new Error('write failed'));
  await mocks.alarm.mock.calls[0]![0]({ name: 'lp-evict' });
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(console.error).toHaveBeenCalledWith(
    'Failed to evict cache',
    expect.any(Error),
  );
});
test('reports alarm scheduling and database-open failures', async () => {
  mocks.get.mockRejectedValueOnce(new Error('alarm failed'));
  await mocks.startup.mock.calls[0]![0]();
  expect(console.error).toHaveBeenCalledWith(
    'Failed to schedule cache eviction',
    expect.any(Error),
  );
  mocks.open.mockRejectedValueOnce(new Error('open failed'));
  await mocks.alarm.mock.calls[0]![0]({ name: 'lp-evict' });
  expect(console.error).toHaveBeenCalledWith(
    'Failed to evict cache',
    expect.any(Error),
  );
});
