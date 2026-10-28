import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { isContentPing } from '../../../src/messaging/content-ping';

const mock = vi.hoisted(() => ({
  connect: vi.fn(),
  onMessageAdd: vi.fn(),
  onMessageRemove: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      connect: mock.connect,
      onMessage: {
        addListener: mock.onMessageAdd,
        removeListener: mock.onMessageRemove,
      },
    },
  },
}));

vi.mock('../../../src/messaging/extension', () => ({
  uiRequest: vi.fn(async () => ({ ok: true })),
}));

import { startPagePipeline } from '../../../src/content/pipeline';

beforeEach(() => {
  document.body.innerHTML = '<p>Source</p>';
  mock.connect.mockReset();
  mock.onMessageAdd.mockReset();
  mock.onMessageRemove.mockReset();
  mock.connect.mockReturnValue({
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  });
  delete window.__lpPipelineDispose;
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value: false,
  });
});

afterEach(() => {
  window.__lpPipelineDispose?.();
  delete window.__lpPipelineDispose;
});

test('defers runtime connection until prerendering finishes', () => {
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value: true,
  });
  startPagePipeline();
  expect(mock.connect).not.toHaveBeenCalled();
  document.dispatchEvent(new Event('prerenderingchange'));
  expect(mock.connect).toHaveBeenCalledOnce();
});

test('reconnects on bfcache pageshow when disconnected', () => {
  startPagePipeline();
  expect(mock.connect).toHaveBeenCalledOnce();
  mock.connect.mockClear();
  const event = new Event('pageshow') as PageTransitionEvent;
  Object.defineProperty(event, 'persisted', { value: true });
  window.dispatchEvent(event);
  expect(mock.connect).toHaveBeenCalledOnce();
});

test('content ping handler reconnects the page port', () => {
  startPagePipeline();
  const handler = mock.onMessageAdd.mock.calls[0]![0] as (
    message: unknown,
    sender: unknown,
    sendResponse: (value: { ok: boolean }) => void,
  ) => boolean | void;
  mock.connect.mockClear();
  const sendResponse = vi.fn();
  expect(isContentPing({ scope: 'lp-content', type: 'ping' })).toBe(true);
  handler({ scope: 'lp-content', type: 'ping' }, {}, sendResponse);
  expect(mock.connect).toHaveBeenCalledOnce();
  expect(sendResponse).toHaveBeenCalledWith({ ok: true });
});

test('replaces an existing pipeline instance on reinjection', () => {
  const firstDispose = startPagePipeline();
  const secondDispose = startPagePipeline();
  expect(firstDispose).not.toBe(secondDispose);
  secondDispose();
});
