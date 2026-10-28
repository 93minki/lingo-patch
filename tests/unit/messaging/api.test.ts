import { beforeEach, expect, test, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import type { createPageService } from '../../../src/messaging/service';
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  tab: vi.fn(),
  permission: vi.fn(),
  open: vi.fn(),
  models: vi.fn(),
  sendMessage: vi.fn(),
  executeScript: vi.fn(),
  getManifest: vi.fn(() => ({
    content_scripts: [{ js: ['content-scripts/content.js'] }],
  })),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'extension',
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      openOptionsPage: mock.open,
      getManifest: mock.getManifest,
    },
    permissions: { contains: mock.permission },
    tabs: { get: mock.tab, sendMessage: mock.sendMessage },
    scripting: { executeScript: mock.executeScript },
  },
}));
vi.mock('../../../src/storage/settings', async (original) => ({
  ...(await original<typeof import('../../../src/storage/settings')>()),
  getSettings: mock.get,
  updateSettings: mock.update,
}));
vi.mock('../../../src/providers', async (original) => ({
  ...(await original<typeof import('../../../src/providers')>()),
  createProvider: () => ({ listModels: mock.models }),
}));
import { createUiApi, translatableUrl } from '../../../src/messaging/api';
import { ProviderError } from '../../../src/providers';
const options = {
  id: 'extension',
  url: 'chrome-extension://extension/options.html',
  tab: { id: 9 },
} as Browser.runtime.MessageSender;
const popup = {
  id: 'extension',
  url: 'chrome-extension://extension/popup.html',
} as Browser.runtime.MessageSender;
const content = {
  id: 'extension',
  url: 'https://site.test/a',
  tab: { id: 1 },
} as Browser.runtime.MessageSender;
const state = {
  available: true,
  configured: true,
  enabled: true,
  hostname: 'site.test',
  origin: 'https://site.test',
  displayMode: 'bilingual',
  autoEnabled: true,
  total: 5,
  restored: 3,
  translated: 1,
  pending: 1,
};
const service = {
  configured: vi.fn(() => true),
  inspect: vi.fn(),
  status: vi.fn(() => ({ ...state })),
  toggle: vi.fn(),
  retranslate: vi.fn(),
  cacheUsage: vi.fn(async () => ({ count: 4, bytes: 100 })),
  clearCache: vi.fn(),
  deleteSiteCache: vi.fn(),
};
const api = createUiApi(
  async () => service as unknown as ReturnType<typeof createPageService>,
);
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mock.tab.mockResolvedValue({ id: 1, url: 'https://site.test/a' });
  mock.permission.mockResolvedValue(true);
  mock.models.mockResolvedValue(['model-a']);
  mock.sendMessage.mockResolvedValue({ ok: true });
  mock.executeScript.mockResolvedValue([]);
  mock.get.mockResolvedValue({
    provider: { provider: 'gemini', apiKey: 'private-key', model: 'model' },
    autoSites: ['site.test'],
    displayMode: 'bilingual',
  });
});
test('getTabStatus runs ensureContent before reporting unavailable', async () => {
  service.status
    .mockReturnValueOnce(undefined as unknown as typeof state)
    .mockReturnValueOnce(undefined as unknown as typeof state)
    .mockReturnValue({ ...state });
  const response = await api({ type: 'getTabStatus', tabId: 1 }, popup);
  expect(mock.sendMessage).toHaveBeenCalledWith(1, {
    scope: 'lp-content',
    type: 'ping',
  });
  expect(response).toEqual({ ok: true, status: state });
});
test('returns only safe tab state and routes toggle and preferences', async () => {
  const response = await api({ type: 'getTabStatus', tabId: 1 }, popup);
  expect(response).toEqual({ ok: true, status: state });
  expect(JSON.stringify(response)).not.toContain('private-key');
  await api({ type: 'toggleTab', tabId: 1 }, popup);
  expect(service.toggle).toHaveBeenCalledWith(1);
  await api({ type: 'setAutoSite', tabId: 1, enabled: false }, popup);
  expect(mock.update).toHaveBeenCalledWith({ autoSites: [] });
  await api({ type: 'setDisplayMode', displayMode: 'original' }, popup);
  expect(mock.update).toHaveBeenCalledWith({ displayMode: 'original' });
});
test('popup and options validate known providers; only options deletes cache', async () => {
  const cfg = {
    provider: 'openai-compatible',
    apiKey: 'fake',
    model: 'model',
    baseUrl: 'http://localhost:123/v1',
  };
  expect(await api({ type: 'validateProvider', cfg }, popup)).toEqual({
    ok: false,
    error: 'permission',
  });
  expect(
    await api(
      {
        type: 'validateProvider',
        cfg: { provider: 'gemini', apiKey: 'fake', model: 'model' },
      },
      popup,
    ),
  ).toEqual({ ok: true, models: ['model-a'] });
  expect(
    await api(
      {
        type: 'validateProvider',
        cfg: {
          provider: 'openai-compatible',
          apiKey: 'fake',
          model: 'm',
          baseUrl: 'https://api.groq.com/openai/v1',
        },
      },
      popup,
    ),
  ).toEqual({ ok: true, models: ['model-a'] });
  mock.models.mockClear();
  expect(await api({ type: 'validateProvider', cfg }, content)).toEqual({
    ok: false,
    error: 'permission',
  });
  expect(await api({ type: 'validateProvider', cfg }, options)).toEqual({
    ok: true,
    models: ['model-a'],
  });
  expect(mock.models).toHaveBeenCalledOnce();
  expect(await api({ type: 'clearCache' }, popup)).toEqual({
    ok: false,
    error: 'permission',
  });
  expect(await api({ type: 'openOptions' }, content)).toEqual({ ok: true });
  expect(mock.open).toHaveBeenCalledOnce();
  expect(await api({ type: 'cacheUsage' }, content)).toEqual({
    ok: false,
    error: 'permission',
  });
});
test('permission denial prevents validation network calls and errors are redacted', async () => {
  const cfg = {
    provider: 'openai-compatible',
    apiKey: 'fake',
    model: 'model',
    baseUrl: 'http://localhost/v1',
  };
  mock.permission.mockResolvedValue(false);
  expect(await api({ type: 'validateProvider', cfg }, options)).toEqual({
    ok: false,
    error: 'permission',
  });
  expect(mock.models).not.toHaveBeenCalled();
  mock.permission.mockResolvedValue(true);
  mock.models.mockRejectedValue(new ProviderError('auth', 'private-key'));
  expect(await api({ type: 'validateProvider', cfg }, options)).toEqual({
    ok: false,
    error: 'auth',
  });
});
test('retranslation and cache operations use background service', async () => {
  await api({ type: 'retranslatePage', tabId: 1 }, popup);
  expect(service.retranslate).toHaveBeenCalledWith(1);
  expect(await api({ type: 'cacheUsage' }, options)).toEqual({
    ok: true,
    usage: { count: 4, bytes: 100 },
  });
  await api({ type: 'clearCache' }, options);
  expect(service.clearCache).toHaveBeenCalledOnce();
  await api(
    { type: 'deleteSiteCache', origin: 'https://site.test/a' },
    options,
  );
  expect(service.deleteSiteCache).toHaveBeenCalledWith('https://site.test');
});
test('blocks internal pages, unknown messages, invalid values and foreign senders', async () => {
  expect(translatableUrl('chrome://settings')).toBe(false);
  expect(translatableUrl('https://chromewebstore.google.com/detail/x')).toBe(
    false,
  );
  mock.tab.mockResolvedValue({ id: 1, url: 'chrome://settings' });
  expect(await api({ type: 'toggleTab', tabId: 1 }, popup)).toEqual({
    ok: false,
    error: 'unavailable',
  });
  expect(
    await api({ type: 'setDisplayMode', displayMode: 'bad' }, popup),
  ).toEqual({ ok: false, error: 'bad_request' });
  expect(await api({ type: 'getTabStatus', tabId: -1 }, popup)).toEqual({
    ok: false,
    error: 'bad_request',
  });
  expect(await api({ type: 'clearCache' }, { id: 'foreign' })).toEqual({
    ok: false,
    error: 'permission',
  });
  expect(await api(null, popup)).toEqual({ ok: false, error: 'bad_request' });
});
