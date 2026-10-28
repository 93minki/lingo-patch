import { expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  focus: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: () => 'chrome-extension://test/options.html' },
    tabs: { query: mock.query, update: mock.update, create: mock.create },
    windows: { update: mock.focus },
  },
}));
import { openOptionsTab } from '../../../src/platform/open-options';

test('creates an options tab with the requested section', async () => {
  mock.query.mockResolvedValueOnce([]);
  await openOptionsTab('glossary');
  expect(mock.create).toHaveBeenCalledWith({
    url: 'chrome-extension://test/options.html#glossary',
  });
});
test('reuses and focuses an existing options tab', async () => {
  mock.query.mockResolvedValueOnce([
    { id: 3, windowId: 8, url: 'chrome-extension://test/options.html#cache' },
  ]);
  await openOptionsTab('sites');
  expect(mock.update).toHaveBeenCalledWith(3, {
    active: true,
    url: 'chrome-extension://test/options.html#sites',
  });
  expect(mock.focus).toHaveBeenCalledWith(8, { focused: true });
});
