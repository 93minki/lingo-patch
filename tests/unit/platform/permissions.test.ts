import { expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: { permissions: { request: mock.request } },
}));
import {
  providerOrigin,
  requestProviderPermission,
} from '../../../src/platform/permissions';
test('limits provider permissions to scheme and host, rejects credentials and unsafe schemes', () => {
  expect(providerOrigin('https://example.test:8443/v1')).toBe(
    'https://example.test/*',
  );
  expect(providerOrigin('http://localhost:11434/v1')).toBe(
    'http://localhost/*',
  );
  expect(providerOrigin('http://[::1]:123/v1')).toBe('http://[::1]/*');
  expect(() => providerOrigin('file:///tmp')).toThrow();
  expect(() => providerOrigin('https://user:secret@example.test')).toThrow();
});
test('requests permission within the click handler and propagates denial', async () => {
  mock.request.mockResolvedValue(false);
  const result = requestProviderPermission('http://localhost:11434/v1');
  expect(mock.request).toHaveBeenCalledWith({
    origins: ['http://localhost/*'],
  });
  await expect(result).resolves.toBe(false);
});
