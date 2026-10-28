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

function mount(
  uiRequest: (request: UiRequest) => Promise<UiResponse>,
  confirm = vi.fn(() => true),
) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <PopupApp
      deps={{
        queryActiveTab: async () => ({ id: 7 }),
        uiRequest,
        confirm,
      }}
    />,
    root,
  );
  return root;
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
  const root = mount(uiRequest);
  await waitReady(root);
  expect(root.textContent).toContain(strings.popup.unavailable);
});

test('prefers unavailable over unconfigured when both apply', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ available: false, configured: false }),
  }));
  const root = mount(uiRequest);
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
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <PopupApp deps={{ queryActiveTab, uiRequest, confirm: vi.fn(() => true) }} />,
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
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <PopupApp
      deps={{
        queryActiveTab: async () => undefined,
        uiRequest,
        confirm: vi.fn(() => true),
      }}
    />,
    root,
  );
  await waitReady(root);
  expect(root.textContent).toContain(strings.popup.unavailable);
  expect(uiRequest).not.toHaveBeenCalled();
});

test('shows only configure action when provider is missing', async () => {
  const uiRequest = vi.fn(async () => ({
    ok: true,
    status: status({ configured: false, available: true }),
  }));
  const root = mount(uiRequest);
  await waitReady(root);
  expect(root.querySelector('button')?.textContent).toBe(
    strings.popup.configure,
  );
  root
    .querySelector('button')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await vi.waitFor(() =>
    expect(uiRequest).toHaveBeenCalledWith({ type: 'openOptions' }),
  );
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
  const root = mount(uiRequest);
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
  const root = mount(uiRequest, confirm);
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
  const root = mount(uiRequest);
  await waitReady(root);
  expect(root.textContent).toContain('12');
  expect(root.textContent).toContain(strings.popup.statsRestored);
  expect(root.textContent).toContain('4');
  expect(root.textContent).toContain('3');
  expect(root.textContent).toContain('2');
});
