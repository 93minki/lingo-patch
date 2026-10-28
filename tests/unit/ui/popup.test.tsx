import { render } from 'preact';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  TabStatus,
  UiRequest,
  UiResponse,
} from '../../../src/messaging/extension';
import {
  PopupApp,
  retranslateCount,
} from '../../../src/entrypoints/popup/main';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch,
} from '../../../src/storage/settings';
import { strings } from '../../../src/ui/strings';

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { query: vi.fn() },
    runtime: {
      id: 'test-extension',
      sendMessage: vi.fn(),
      getURL: (path: string) => `chrome-extension://test${path}`,
    },
  },
}));

const status = (patch: Partial<TabStatus> = {}): TabStatus => ({
  available: true,
  configured: true,
  enabled: false,
  hostname: 'docs.example.com',
  origin: 'https://docs.example.com',
  displayMode: 'bilingual',
  autoEnabled: false,
  total: 12,
  restored: 4,
  translated: 3,
  pending: 2,
  ...patch,
});

function createSettingsDeps(initial: Settings = DEFAULT_SETTINGS) {
  let current = structuredClone(initial);
  const listeners = new Set<(settings: Settings) => void>();
  return {
    getSettings: vi.fn(async () => structuredClone(current)),
    updateSettings: vi.fn(async (patch: SettingsPatch) => {
      current = {
        ...current,
        ...patch,
        cache: patch.cache
          ? { ...current.cache, ...patch.cache }
          : current.cache,
        autoSites: patch.autoSites ?? current.autoSites,
        provider:
          patch.provider !== undefined ? patch.provider : current.provider,
        preset: patch.preset !== undefined ? patch.preset : current.preset,
      };
      for (const listener of listeners) listener(structuredClone(current));
      return structuredClone(current);
    }),
    onSettingsChanged: vi.fn((listener: (settings: Settings) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    requestProviderPermission: vi.fn(async () => true),
    get current() {
      return current;
    },
  };
}

function mount(
  uiRequest: (request: UiRequest) => Promise<UiResponse>,
  confirm = vi.fn(() => true),
  openOptionsPage = vi.fn(),
  settingsDeps = createSettingsDeps(),
) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <PopupApp
      deps={{
        queryActiveTab: async () => ({ id: 7 }),
        uiRequest,
        confirm,
        openOptionsPage,
        getSettings: settingsDeps.getSettings,
        updateSettings: settingsDeps.updateSettings,
        onSettingsChanged: settingsDeps.onSettingsChanged,
        requestProviderPermission: settingsDeps.requestProviderPermission,
      }}
    />,
    root,
  );
  return { root, openOptionsPage, settingsDeps };
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
});

async function waitReady(root: HTMLElement) {
  await vi.waitFor(() => {
    expect(root.textContent).not.toContain(strings.popup.loading);
  });
}

async function openPopupSettings(root: HTMLElement) {
  const settings = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === strings.popup.settings,
  );
  settings?.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.popup.settingsBack),
  );
}

test('retranslateCount prefers total segments when present', () => {
  expect(
    retranslateCount(status({ total: 9, restored: 1, translated: 1 })),
  ).toBe(9);
  expect(
    retranslateCount(status({ total: 0, restored: 2, translated: 3 })),
  ).toBe(5);
});

test('shows unavailable guidance on internal pages', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ available: false, hostname: 'chrome' }),
  }));
  const { root } = mount(uiRequest);
  await waitReady(root);
  expect(root.textContent).toContain(strings.popup.unavailable);
});

test('prefers unavailable over unconfigured when both apply', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ available: false, configured: false }),
  }));
  const { root } = mount(uiRequest);
  await waitReady(root);
  expect(root.textContent).toContain(strings.popup.unavailable);
  expect(root.textContent).not.toContain(strings.popup.configure);
});

test('shows retry UI when the active tab query fails', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status(),
  }));
  let attempts = 0;
  const queryActiveTab = vi.fn(async () => {
    attempts++;
    if (attempts === 1) throw new Error('tabs failed');
    return { id: 7 };
  });
  const settingsDeps = createSettingsDeps();
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <PopupApp
      deps={{
        queryActiveTab,
        uiRequest,
        confirm: vi.fn(() => true),
        openOptionsPage: vi.fn(),
        getSettings: settingsDeps.getSettings,
        updateSettings: settingsDeps.updateSettings,
        onSettingsChanged: settingsDeps.onSettingsChanged,
        requestProviderPermission: settingsDeps.requestProviderPermission,
      }}
    />,
    root,
  );
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.popup.retry),
  );
  root.querySelector('button')?.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.popup.autoSite),
  );
});

test('shows unavailable when no active tab is returned', async () => {
  const uiRequest = vi.fn();
  const settingsDeps = createSettingsDeps();
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <PopupApp
      deps={{
        queryActiveTab: async () => undefined,
        uiRequest,
        confirm: vi.fn(() => true),
        openOptionsPage: vi.fn(),
        getSettings: settingsDeps.getSettings,
        updateSettings: settingsDeps.updateSettings,
        onSettingsChanged: settingsDeps.onSettingsChanged,
        requestProviderPermission: settingsDeps.requestProviderPermission,
      }}
    />,
    root,
  );
  await waitReady(root);
  expect(root.textContent).toContain(strings.popup.unavailable);
  expect(uiRequest).not.toHaveBeenCalled();
});

test('configure opens in-popup settings instead of openOptions', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ configured: false, available: true }),
  }));
  const { root } = mount(uiRequest);
  await waitReady(root);
  const configure = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === strings.popup.configure,
  );
  configure?.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.engine),
  );
  expect(uiRequest).not.toHaveBeenCalledWith({ type: 'openOptions' });
});

test('settings link switches to in-popup settings screen', async () => {
  const openOptionsPage = vi.fn();
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ configured: false }),
  }));
  const { root } = mount(
    uiRequest,
    vi.fn(() => true),
    openOptionsPage,
  );
  await waitReady(root);
  await openPopupSettings(root);
  expect(openOptionsPage).not.toHaveBeenCalled();
  expect(root.textContent).toContain(strings.options.validateKey);
});

test('custom engine selection shows advanced guide in popup settings', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ configured: false }),
  }));
  const { root } = mount(uiRequest);
  await waitReady(root);
  await openPopupSettings(root);
  const engineSelect = root.querySelector('#popup-engine') as HTMLSelectElement;
  engineSelect.value = 'custom';
  engineSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.popup.customEngineGuide),
  );
});

test('validate key in popup settings uses uiRequest', async () => {
  const uiRequest = vi.fn(async (request: UiRequest) => {
    if (request.type === 'getTabStatus')
      return { ok: true, status: status({ configured: false }) };
    if (request.type === 'validateProvider')
      return { ok: true, models: ['gemini-2.5-pro'] };
    return { ok: false, error: 'bad_request' as const };
  });
  const { root } = mount(uiRequest);
  await waitReady(root);
  await openPopupSettings(root);
  const apiKey = root.querySelector('#popup-api-key') as HTMLInputElement;
  apiKey.value = 'secret';
  apiKey.dispatchEvent(new Event('input', { bubbles: true }));
  const validate = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === strings.options.validateKey,
  );
  validate?.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.validateOk),
  );
  expect(uiRequest).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'validateProvider' }),
  );
});

test('shows key validation failure without exposing the key', async () => {
  const uiRequest = vi.fn(async (request: UiRequest) => {
    if (request.type === 'getTabStatus')
      return { ok: true, status: status({ configured: false }) };
    if (request.type === 'validateProvider')
      return { ok: false, error: 'auth' as const };
    return { ok: false, error: 'bad_request' as const };
  });
  const { root } = mount(uiRequest);
  await waitReady(root);
  await openPopupSettings(root);
  const apiKey = root.querySelector('#popup-api-key') as HTMLInputElement;
  apiKey.value = 'fake-key';
  apiKey.dispatchEvent(new Event('input', { bubbles: true }));
  [...root.querySelectorAll('button')]
    .find((node) => node.textContent === strings.options.validateKey)
    ?.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.validationAuth),
  );
  expect(root.textContent).not.toContain('fake-key');
});

test('engine save returns to main and refreshes tab status', async () => {
  const settingsDeps = createSettingsDeps();
  const uiRequest = vi.fn(async (request: UiRequest) => {
    if (request.type === 'getTabStatus')
      return {
        ok: true,
        status: status({
          configured: Boolean(settingsDeps.current.provider),
          available: true,
        }),
      };
    if (request.type === 'validateProvider')
      return { ok: true, models: ['gemini-2.5-pro'] };
    return { ok: false, error: 'bad_request' as const };
  });
  const { root } = mount(
    uiRequest,
    vi.fn(() => true),
    vi.fn(),
    settingsDeps,
  );
  await waitReady(root);
  await openPopupSettings(root);
  const apiKey = root.querySelector('#popup-api-key') as HTMLInputElement;
  apiKey.value = 'secret';
  apiKey.dispatchEvent(new Event('input', { bubbles: true }));
  const validate = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === strings.options.validateKey,
  );
  validate?.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.validateOk),
  );
  const save = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === strings.options.save,
  );
  save?.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.popup.autoSite),
  );
  expect(settingsDeps.updateSettings).toHaveBeenCalled();
});

test('advanced settings link opens the options page from popup settings', async () => {
  const openOptionsPage = vi.fn();
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ configured: false }),
  }));
  const { root } = mount(
    uiRequest,
    vi.fn(() => true),
    openOptionsPage,
  );
  await waitReady(root);
  await openPopupSettings(root);
  const advanced = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === strings.popup.advancedSettingsLink,
  );
  advanced?.click();
  expect(openOptionsPage).toHaveBeenCalledOnce();
});

test('toggles auto translate and polls tab status every 500ms', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const uiRequest = vi.fn(async (request: UiRequest) => {
    if (request.type === 'getTabStatus')
      return { ok: true, status: status({ autoEnabled: false }) };
    if (request.type === 'setAutoSite')
      return { ok: true, status: status({ autoEnabled: true }) };
    return { ok: false, error: 'bad_request' as const };
  });
  const { root } = mount(uiRequest);
  await waitReady(root);
  const initialCalls = uiRequest.mock.calls.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(uiRequest.mock.calls.length).toBeGreaterThan(initialCalls);
  const checkbox = root.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement;
  checkbox.click();
  await vi.waitFor(() =>
    expect(uiRequest).toHaveBeenCalledWith({
      type: 'setAutoSite',
      tabId: 7,
      enabled: true,
    }),
  );
});

test('asks once before retranslate and sends the page request', async () => {
  const confirm = vi.fn(() => true);
  const uiRequest = vi.fn(async (request: UiRequest) => {
    if (request.type === 'getTabStatus') return { ok: true, status: status() };
    if (request.type === 'retranslatePage') return { ok: true };
    return { ok: false, error: 'bad_request' as const };
  });
  const { root } = mount(uiRequest, confirm);
  await waitReady(root);
  const button = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === strings.popup.retranslate,
  );
  button?.click();
  expect(confirm).toHaveBeenCalledWith(strings.popup.retranslateConfirm(12));
  await vi.waitFor(() =>
    expect(uiRequest).toHaveBeenCalledWith({
      type: 'retranslatePage',
      tabId: 7,
    }),
  );
});

test('renders four page stats from tab status', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status(),
  }));
  const { root } = mount(uiRequest);
  await waitReady(root);
  expect(root.textContent).toContain('12');
  expect(root.textContent).toContain(strings.popup.statsRestored);
  expect(root.textContent).toContain('4');
  expect(root.textContent).toContain('3');
  expect(root.textContent).toContain('2');
});

test('shows checking copy while tab status is loading', async () => {
  let resolveStatus: (value: UiResponse) => void = () => {};
  const uiRequest = vi.fn(
    () =>
      new Promise<UiResponse>((resolve) => {
        resolveStatus = resolve;
      }),
  );
  const { root } = mount(uiRequest);
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.popup.checking),
  );
  resolveStatus({ ok: true, status: status() });
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.popup.autoSite),
  );
});

test('subscribes to settings changes while settings view is open', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ configured: false }),
  }));
  const settingsDeps = createSettingsDeps();
  const { root } = mount(
    uiRequest,
    vi.fn(() => true),
    vi.fn(),
    settingsDeps,
  );
  await waitReady(root);
  await openPopupSettings(root);
  expect(settingsDeps.onSettingsChanged).toHaveBeenCalled();
  await settingsDeps.updateSettings({ targetLang: 'en' });
  await vi.waitFor(() => {
    const select = root.querySelector(
      '#popup-target-lang',
    ) as HTMLSelectElement;
    expect(select?.value).toBe('en');
  });
});
