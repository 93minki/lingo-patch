import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  onChangedAdd: vi.fn(),
  storageChanges: [] as Array<
    (changes: Record<string, { newValue?: unknown }>, area: string) => void
  >,
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: mocks.get,
        set: mocks.set,
      },
      onChanged: {
        addListener: (listener: (typeof mocks.storageChanges)[number]) => {
          mocks.onChangedAdd(listener);
          mocks.storageChanges.push(listener);
        },
      },
    },
  },
}));

import {
  DEFAULT_SETTINGS,
  getSettings,
  normalizeSettings,
  onSettingsChanged,
  updateSettings,
} from '../../../src/storage/settings';

beforeEach(() => {
  mocks.get.mockReset();
  mocks.set.mockReset();
  mocks.onChangedAdd.mockReset();
  mocks.storageChanges.length = 0;
  mocks.get.mockResolvedValue({});
  mocks.set.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('getSettings returns defaults when storage is empty', async () => {
  await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
});

test('returned settings are isolated from DEFAULT_SETTINGS', async () => {
  const first = await getSettings();
  first.autoSites.push('example.com');
  first.cache.ttlDays = 1;
  expect(DEFAULT_SETTINGS.autoSites).toEqual([]);
  expect(DEFAULT_SETTINGS.cache).toEqual({ ttlDays: 90, maxMB: 20 });
  const second = await getSettings();
  expect(second.autoSites).toEqual([]);
  expect(second.cache).toEqual({ ttlDays: 90, maxMB: 20 });
});

test('normalizeSettings does not share fallback arrays or cache objects', () => {
  const normalized = normalizeSettings(undefined);
  normalized.autoSites.push('mutated');
  normalized.cache.maxMB = 99;
  expect(DEFAULT_SETTINGS.autoSites).toEqual([]);
  expect(DEFAULT_SETTINGS.cache.maxMB).toBe(20);
});

test('normalizeSettings merges defaults for corrupted fields', () => {
  expect(
    normalizeSettings({
      provider: { provider: 'openai', apiKey: 1, model: 'gpt' },
      targetLang: '',
      autoSites: [1, 'ok'],
      displayMode: 'invalid',
      cache: { ttlDays: -1, maxMB: 'big' },
      preset: 'unknown',
    }),
  ).toEqual({
    provider: null,
    hoverModifier: 'alt',
    selectionTranslation: true,
    skipFixedBars: true,
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    cache: { ttlDays: 90, maxMB: 20 },
  });
});

test('normalizeSettings keeps a valid provider config', () => {
  expect(
    normalizeSettings({
      provider: {
        provider: 'gemini',
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      },
    }).provider,
  ).toEqual({
    provider: 'gemini',
    apiKey: 'test-key',
    model: 'gemini-2.5-flash',
  });
});

test('parseProvider rules for apiKey and baseUrl', () => {
  expect(
    normalizeSettings({
      provider: { provider: 'openai', apiKey: '', model: 'gpt-6-luna' },
    }).provider,
  ).toBeNull();
  expect(
    normalizeSettings({
      provider: {
        provider: 'openai-compatible',
        apiKey: '',
        model: 'llama3',
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
    }).provider,
  ).toEqual({
    provider: 'openai-compatible',
    apiKey: '',
    model: 'llama3',
    baseUrl: 'http://127.0.0.1:11434/v1',
  });
  expect(
    normalizeSettings({
      provider: {
        provider: 'openai-compatible',
        apiKey: 'key',
        model: 'm',
        baseUrl: 'file:///tmp',
      },
    }).provider,
  ).toBeNull();
});

test('updateSettings patches cache fields safely', async () => {
  mocks.get.mockResolvedValue({
    'lp-settings': { cache: { ttlDays: 90, maxMB: 20 } },
  });
  await expect(updateSettings({ cache: { ttlDays: 30 } })).resolves.toEqual({
    ...DEFAULT_SETTINGS,
    cache: { ttlDays: 30, maxMB: 20 },
  });
  expect(mocks.set).toHaveBeenCalledWith({
    'lp-settings': {
      ...DEFAULT_SETTINGS,
      cache: { ttlDays: 30, maxMB: 20 },
    },
  });
});

test('updateSettings rejects invalid provider patches', async () => {
  mocks.get.mockResolvedValue({
    'lp-settings': {
      provider: {
        provider: 'openai',
        apiKey: 'keep',
        model: 'gpt-6-luna',
      },
    },
  });
  await expect(
    updateSettings({
      provider: { provider: 'openai', apiKey: 'x', model: '' },
    }),
  ).resolves.toMatchObject({ provider: null });
});

test('serializes concurrent updateSettings calls without losing patches', async () => {
  let stored: unknown = {};
  mocks.get.mockImplementation(async () => ({ 'lp-settings': stored }));
  mocks.set.mockImplementation(async (value: Record<string, unknown>) => {
    stored = value['lp-settings'];
  });
  const [first, second] = await Promise.all([
    updateSettings({ targetLang: 'en' }),
    updateSettings({ displayMode: 'translation' }),
  ]);
  expect(first.targetLang).toBe('en');
  expect(second.displayMode).toBe('translation');
  await expect(getSettings()).resolves.toMatchObject({
    targetLang: 'en',
    displayMode: 'translation',
  });
});

test('allows a write after a failed updateSettings', async () => {
  mocks.set.mockRejectedValueOnce(new Error('storage failed'));
  await expect(updateSettings({ targetLang: 'en' })).rejects.toThrow(
    'storage failed',
  );
  mocks.set.mockResolvedValue(undefined);
  await expect(updateSettings({ targetLang: 'ja' })).resolves.toMatchObject({
    targetLang: 'ja',
  });
});

test('onSettingsChanged unsubscribes and reacts to storage updates', async () => {
  const seen: string[] = [];
  const unsubscribe = onSettingsChanged((settings) => {
    seen.push(settings.targetLang);
  });
  expect(mocks.onChangedAdd).toHaveBeenCalledOnce();
  mocks.storageChanges[0]!(
    { 'lp-settings': { newValue: { targetLang: 'ja' } } },
    'local',
  );
  expect(seen).toEqual(['ja']);
  unsubscribe();
  mocks.storageChanges[0]!(
    { 'lp-settings': { newValue: { targetLang: 'en' } } },
    'local',
  );
  expect(seen).toEqual(['ja']);
});

test('fixed bar setting defaults on, preserves false and ignores damaged values', async () => {
  expect(normalizeSettings({}).skipFixedBars).toBe(true);
  expect(normalizeSettings({ skipFixedBars: false }).skipFixedBars).toBe(false);
  expect(normalizeSettings({ skipFixedBars: 'bad' }).skipFixedBars).toBe(true);
});
