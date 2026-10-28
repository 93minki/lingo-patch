import { expect, test, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  contains: vi.fn(),
  request: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: {
      contains: mock.contains,
      request: mock.request,
    },
  },
}));

import {
  hasPageAccess,
  hasProviderAccess,
  requestAccess,
  requestPageAccess,
  requestProviderAccess,
} from '../../../src/platform/host-access';

test('hasPageAccess checks origin wildcard permission', async () => {
  mock.contains.mockResolvedValue(true);
  await expect(hasPageAccess('https://docs.example.com')).resolves.toBe(true);
  expect(mock.contains).toHaveBeenCalledWith({
    origins: ['https://docs.example.com/*'],
  });
});

test('hasProviderAccess maps base URLs to provider origins', async () => {
  mock.contains.mockResolvedValue(false);
  await hasProviderAccess(['https://api.groq.com/openai/v1']);
  expect(mock.contains).toHaveBeenCalledWith({
    origins: ['https://api.groq.com/*'],
  });
});

test('requestPageAccess requests all sites or a single origin', async () => {
  mock.request.mockResolvedValue(true);
  await requestPageAccess('https://news.example.com');
  expect(mock.request).toHaveBeenCalledWith({
    origins: ['https://news.example.com/*'],
  });
  await requestPageAccess('all');
  expect(mock.request).toHaveBeenCalledWith({
    origins: ['https://*/*', 'http://*/*'],
  });
});

test('requestProviderAccess requests provider origin only', async () => {
  mock.request.mockResolvedValue(true);
  await requestProviderAccess('https://api.example.com/v1');
  expect(mock.request).toHaveBeenCalledWith({
    origins: ['https://api.example.com/*'],
  });
});

test('requestAccess merges page and provider origins', async () => {
  mock.request.mockResolvedValue(true);
  await requestAccess({
    pages: 'https://tab.example',
    providers: ['https://api.example.com/v1'],
  });
  expect(mock.request).toHaveBeenCalledWith({
    origins: ['https://tab.example/*', 'https://api.example.com/*'],
  });
});
