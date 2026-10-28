import { browser, type Browser } from 'wxt/browser';
import { createProvider, ProviderError } from '../providers';
import { PRESETS } from '../providers/presets';
import {
  getSettings,
  updateSettings,
  normalizeSettings,
} from '../storage/settings';
import type { createPageService } from './service';
import type { UiResponse, TabStatus } from './extension';
import { providerOrigin } from '../platform/permissions';
import { CONTENT_PING } from './content-ping';

type Service = ReturnType<typeof createPageService>;

export function waitForConnection(
  hasConnection: () => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (hasConnection()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export async function ensureContent(
  tabId: number,
  service: Pick<Service, 'status'>,
  deps: {
    sendMessage: (
      tabId: number,
      message: typeof CONTENT_PING,
    ) => Promise<unknown>;
    executeScript: (injection: {
      target: { tabId: number };
      files: string[];
    }) => Promise<unknown>;
    getManifest: () => { content_scripts?: { js?: string[] }[] };
  } = {
    sendMessage: (id, message) => browser.tabs.sendMessage(id, message),
    executeScript: (injection) =>
      browser.scripting.executeScript(
        injection as Parameters<typeof browser.scripting.executeScript>[0],
      ),
    getManifest: () => browser.runtime.getManifest(),
  },
): Promise<boolean> {
  if (service.status(tabId)) return true;
  try {
    await deps.sendMessage(tabId, CONTENT_PING);
    if (await waitForConnection(() => Boolean(service.status(tabId)), 1000))
      return true;
  } catch {
    /* Content script missing or ping failed. */
  }
  const files = deps.getManifest().content_scripts?.[0]?.js;
  if (!files?.length) return false;
  try {
    await deps.executeScript({
      target: { tabId },
      files: [...files],
    });
  } catch {
    return false;
  }
  return waitForConnection(() => Boolean(service.status(tabId)), 1500);
}
export function translatableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      ![
        'chromewebstore.google.com',
        'chrome.google.com',
        'addons.mozilla.org',
      ].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
export function createUiApi(getService: () => Promise<Service>) {
  return async (
    message: unknown,
    sender: Browser.runtime.MessageSender,
  ): Promise<UiResponse> => {
    if (typeof message !== 'object' || message === null || !('type' in message))
      return { ok: false, error: 'bad_request' };
    const request = message as Record<string, unknown>;
    // Options can also run in a tab; only extension pages may invoke privileged UI APIs.
    const ownPage =
      sender.id === browser.runtime.id &&
      sender.url?.startsWith(browser.runtime.getURL(''));
    const optionsPage =
      ownPage && new URL(sender.url!).pathname === '/options.html';
    const popupPage =
      ownPage && new URL(sender.url!).pathname === '/popup.html';
    if (!ownPage) {
      if (request.type === 'openOptions' && sender.id === browser.runtime.id) {
        await browser.runtime.openOptionsPage();
        return { ok: true };
      }
      return { ok: false, error: 'permission' };
    }
    try {
      if (request.type === 'openOptions') {
        await browser.runtime.openOptionsPage();
        return { ok: true };
      }
      if (request.type === 'validateProvider') {
        if (!optionsPage && !popupPage)
          return { ok: false, error: 'permission' };
        const cfg = normalizeSettings({ provider: request.cfg }).provider;
        if (!cfg) return { ok: false, error: 'bad_request' };
        if (
          popupPage &&
          cfg.provider === 'openai-compatible' &&
          !PRESETS.some((preset) => preset.baseUrl === cfg.baseUrl)
        )
          return { ok: false, error: 'permission' };
        if (
          cfg.baseUrl &&
          !(await browser.permissions.contains({
            origins: [providerOrigin(cfg.baseUrl)],
          }))
        )
          return { ok: false, error: 'permission' };
        return { ok: true, models: await createProvider(cfg).listModels() };
      }
      const service = await getService();
      if (
        request.type === 'cacheExportBatch' ||
        request.type === 'cacheImportBatch'
      ) {
        if (!optionsPage) return { ok: false, error: 'permission' };
        if (request.type === 'cacheExportBatch') {
          if (
            request.after !== undefined &&
            (typeof request.after !== 'string' ||
              !/^[a-f0-9]{32}$/u.test(request.after))
          )
            return { ok: false, error: 'bad_request' };
          return {
            ok: true,
            entries: await service.cacheExportBatch(
              request.after as string | undefined,
            ),
          };
        }
        if (!Array.isArray(request.lines))
          return { ok: false, error: 'bad_request' };
        return {
          ok: true,
          importResult: await service.cacheImportBatch(
            request.header,
            request.size,
            request.lines,
            request.finish === true,
          ),
        };
      }
      if (request.type === 'cacheUsage')
        return { ok: true, usage: await service.cacheUsage() };
      if (request.type === 'clearCache' || request.type === 'deleteSiteCache') {
        if (!optionsPage) return { ok: false, error: 'permission' };
        if (request.type === 'clearCache') await service.clearCache();
        else {
          if (
            typeof request.origin !== 'string' ||
            !translatableUrl(request.origin)
          )
            return { ok: false, error: 'bad_request' };
          await service.deleteSiteCache(new URL(request.origin).origin);
        }
        return { ok: true };
      }
      if (request.type === 'setDisplayMode') {
        if (
          !['bilingual', 'translation', 'original'].includes(
            request.displayMode as string,
          )
        )
          return { ok: false, error: 'bad_request' };
        await updateSettings({
          displayMode: request.displayMode as TabStatus['displayMode'],
        });
        return { ok: true };
      }
      if (!Number.isSafeInteger(request.tabId) || (request.tabId as number) < 0)
        return { ok: false, error: 'bad_request' };
      const tabId = request.tabId as number;
      const tab = await browser.tabs.get(tabId);
      const url = tab.url ?? '';
      const translatable = translatableUrl(url);
      let hasConnection = Boolean(service.status(tabId));
      if (translatable && !hasConnection)
        hasConnection = await ensureContent(tabId, service);
      const available = translatable && hasConnection;
      if (available && request.type === 'getTabStatus')
        await service.inspect(tabId);
      const settings = await getSettings();
      const parsed = translatable ? new URL(url) : undefined;
      const status: TabStatus = service.status(tabId) ?? {
        available: false,
        configured: Boolean(settings.provider),
        enabled: false,
        hostname: parsed?.hostname ?? '',
        origin: parsed?.origin ?? '',
        displayMode: settings.displayMode,
        autoEnabled: settings.autoSites.includes(parsed?.hostname ?? ''),
        total: 0,
        restored: 0,
        translated: 0,
        pending: 0,
      };
      status.available = translatable && Boolean(service.status(tabId));
      switch (request.type) {
        case 'getTabStatus':
          return { ok: true, status };
        case 'setAutoSite': {
          if (!available || typeof request.enabled !== 'boolean')
            return { ok: false, error: 'unavailable' };
          const sites = new Set(settings.autoSites);
          if (request.enabled) sites.add(status.hostname);
          else sites.delete(status.hostname);
          await updateSettings({ autoSites: [...sites] });
          return { ok: true };
        }
        case 'toggleTab':
          if (!available) return { ok: false, error: 'unavailable' };
          if (!settings.provider) {
            await browser.runtime.openOptionsPage();
            return { ok: true };
          }
          service.toggle(tabId);
          return { ok: true };
        case 'retranslatePage':
          if (!available || !settings.provider)
            return { ok: false, error: 'unavailable' };
          await service.retranslate(tabId);
          return { ok: true };
        default:
          return { ok: false, error: 'bad_request' };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ProviderError ? error.kind : 'network',
      };
    }
  };
}
