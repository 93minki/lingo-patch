import { afterEach, expect, test, vi } from 'vitest';
import { CONTENT_PING } from '../../../src/messaging/content-ping';
import { ensureContent, waitForConnection } from '../../../src/messaging/api';

afterEach(() => {
  vi.useRealTimers();
});

test('waitForConnection resolves immediately when already connected', async () => {
  await expect(waitForConnection(() => true, 500)).resolves.toBe(true);
});

test('ensureContent returns true when ping restores the tab connection', async () => {
  vi.useFakeTimers();
  const status = vi
    .fn()
    .mockReturnValueOnce(undefined)
    .mockReturnValue({ available: true });
  const sendMessage = vi.fn(async () => ({ ok: true }));
  const executeScript = vi.fn();
  const promise = ensureContent(3, { status }, {
    sendMessage,
    executeScript,
    getManifest: () =>
      ({ content_scripts: [{ js: ['content.js'] }] }),
  });
  await vi.advanceTimersByTimeAsync(0);
  await expect(promise).resolves.toBe(true);
  expect(sendMessage).toHaveBeenCalledWith(3, CONTENT_PING);
  expect(executeScript).not.toHaveBeenCalled();
});

test('ensureContent injects the manifest content script when ping fails', async () => {
  vi.useFakeTimers();
  const status = vi
    .fn()
    .mockReturnValueOnce(undefined)
    .mockReturnValueOnce(undefined)
    .mockReturnValue({ available: true });
  const sendMessage = vi.fn(async () => {
    throw new Error('missing receiver');
  });
  const executeScript = vi.fn(async () => []);
  const promise = ensureContent(4, { status }, {
    sendMessage,
    executeScript,
    getManifest: () => ({
      content_scripts: [{ js: ['content-scripts/content.js'] }],
    }),
  });
  await vi.advanceTimersByTimeAsync(1600);
  await expect(promise).resolves.toBe(true);
  expect(executeScript).toHaveBeenCalledWith({
    target: { tabId: 4 },
    files: ['content-scripts/content.js'],
  });
});

test('ensureContent returns false when ping and injection both fail', async () => {
  vi.useFakeTimers();
  const status = vi.fn(() => undefined);
  const promise = ensureContent(5, { status }, {
    sendMessage: vi.fn(async () => {
      throw new Error('missing receiver');
    }),
    executeScript: vi.fn(async () => []),
    getManifest: () => ({
      content_scripts: [{ js: ['content-scripts/content.js'] }],
    }),
  });
  await vi.advanceTimersByTimeAsync(2600);
  await expect(promise).resolves.toBe(false);
});
