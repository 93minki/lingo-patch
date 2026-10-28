import { beforeEach, expect, test, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const mock = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  fail: false,
}));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: mock.data[key] }),
        set: async (values: Record<string, unknown>) => {
          if (mock.fail) throw new Error('write failed');
          Object.assign(mock.data, structuredClone(values));
        },
        remove: async (key: string) => {
          delete mock.data[key];
        },
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));
import { getSettings, updateSettings } from '../../../src/storage/settings';
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  clearAllApiKeys,
} from '../../../src/storage/secrets';

beforeEach(() => {
  mock.data = {};
  mock.fail = false;
});
test('migrates a legacy preset key and removes it from settings', async () => {
  mock.data['lp-settings'] = {
    provider: { provider: 'openai-compatible', model: 'm', apiKey: 'old-key' },
    preset: 'groq',
  };
  const settings = await getSettings();
  expect(settings.provider).toEqual({
    provider: 'openai-compatible',
    model: 'm',
  });
  expect(await getApiKey('groq')).toBe('old-key');
  expect(JSON.stringify(mock.data['lp-settings'])).not.toContain('old-key');
  await updateSettings({ targetLang: 'en' });
  expect(JSON.stringify(mock.data['lp-settings'])).not.toContain('apiKey');
});
test('migration preserves a separately stored key and never deletes legacy data on write failure', async () => {
  await setApiKey('openai', 'new-key');
  mock.data['lp-settings'] = {
    provider: { provider: 'openai', model: 'm', apiKey: 'old-key' },
  };
  await getSettings();
  expect(await getApiKey('openai')).toBe('new-key');
  mock.data['lp-settings'] = {
    provider: { provider: 'gemini', model: 'm', apiKey: 'keep-key' },
  };
  mock.fail = true;
  await expect(getSettings()).rejects.toThrow('write failed');
  expect(JSON.stringify(mock.data['lp-settings'])).toContain('keep-key');
});
test('deleting one key preserves other providers and deleting all removes the secret entry', async () => {
  await Promise.all([
    setApiKey('openai', 'a'),
    setApiKey('gemini', 'b'),
    setApiKey('groq', 'c'),
  ]);
  await clearApiKey('openai');
  expect(await getApiKey('openai')).toBeUndefined();
  expect(await getApiKey('gemini')).toBe('b');
  expect(await getApiKey('groq')).toBe('c');
  expect(mock.data['lp-secrets']).not.toHaveProperty('openai');
  await clearAllApiKeys();
  expect(mock.data).not.toHaveProperty('lp-secrets');
});
test('content source never references the secret store', () => {
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else
        expect(readFileSync(file, 'utf8')).not.toMatch(/lp-secrets|getApiKey/u);
    }
  };
  visit('src/content');
});
