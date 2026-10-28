import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TOUCH_INTERVAL_MS } from '../../../src/core/cache/policy';

const mocks = vi.hoisted(() => ({
  installed: vi.fn(),
  startup: vi.fn(),
  alarm: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  evict: vi.fn(),
  close: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  settingsChanged: vi.fn(),
  command: vi.fn(),
  tabs: vi.fn(),
  toggle: vi.fn(),
  serviceUpdate: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      onConnect: { addListener: vi.fn() },
      openOptionsPage: vi.fn(async () => {}),
      onInstalled: { addListener: mocks.installed },
      onStartup: { addListener: mocks.startup },
    },
    commands: { onCommand: { addListener: mocks.command } },
    tabs: { query: mocks.tabs },
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
vi.mock('../../../src/storage/settings', () => ({
  getSettings: mocks.getSettings,
  onSettingsChanged: mocks.settingsChanged,
  updateSettings: mocks.updateSettings,
}));
vi.mock('../../../src/messaging/service', () => ({
  createPageService: () => ({
    toggle: mocks.toggle,
    update: mocks.serviceUpdate,
  }),
}));
import { browser } from 'wxt/browser';
import background from '../../../src/entrypoints/background';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tabs.mockResolvedValue([{ id: 7 }]);
  mocks.get.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue(undefined);
  mocks.getSettings.mockResolvedValue({
    provider: null,
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    cache: { ttlDays: 90, maxMB: 20 },
  });
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
test('runs eviction for lp-evict using settings cache limits', async () => {
  const listener = mocks.alarm.mock.calls[0]![0];
  await listener({ name: 'unrelated' });
  expect(mocks.open).not.toHaveBeenCalled();
  mocks.getSettings.mockResolvedValueOnce({
    provider: null,
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    cache: { ttlDays: 30, maxMB: 10 },
  });
  await listener({ name: 'lp-evict' });
  expect(mocks.getSettings).toHaveBeenCalledOnce();
  expect(mocks.evict).toHaveBeenCalledWith(expect.any(Number), {
    ttlMs: 30 * TOUCH_INTERVAL_MS,
    maxBytes: 10 * 1024 * 1024,
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

test('keyboard command cycles saved display mode in order', async () => {
  const command = mocks.command.mock.calls[0]![0];
  for (const [mode, expected] of [
    ['bilingual', 'translation'],
    ['translation', 'original'],
    ['original', 'bilingual'],
  ]) {
    mocks.getSettings.mockResolvedValueOnce({ displayMode: mode });
    await command('cycle-mode');
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      displayMode: expected,
    });
  }
});
test('toggle command opens setup without a key and targets active tab; settings changes reach service', async () => {
  await mocks.command.mock.calls[0]![0]('toggle-translate');
  expect(browser.runtime.openOptionsPage).toHaveBeenCalledOnce();
  expect(mocks.toggle).toHaveBeenCalledWith(7);
  const next = { displayMode: 'original' };
  mocks.settingsChanged.mock.calls[0]![0](next);
  await Promise.resolve();
  expect(mocks.serviceUpdate).toHaveBeenCalledWith(next);
});
