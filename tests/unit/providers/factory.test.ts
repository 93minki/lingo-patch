import { expect, test, vi } from 'vitest';
import { createProvider, type ProviderId } from '../../../src/providers';
test.each<ProviderId>(['openai', 'anthropic', 'gemini', 'openai-compatible'])(
  'routes %s without making a network request',
  (provider) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      createProvider(
        { provider, apiKey: 'test-key', model: 'test-model' },
        { fetch: fetcher },
      ).id,
    ).toBe(provider);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
