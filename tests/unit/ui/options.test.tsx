import { render } from 'preact';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  buildProviderConfig,
  filterOpenRouterModels,
  filterOptionsCommands,
  formatModelLabel,
  isEngineModelAllowed,
  isHttpProviderBaseUrl,
  LIST_MODELS_PROBE,
  listModelChoices,
  modelSelectChoices,
  normalizeAutoSiteHostname,
  OptionsApp,
  type OptionsDeps,
  parseCacheField,
  persistEngineSettings,
  pickDefaultModel,
  providerFingerprint,
  showsOnboarding,
  validateProviderKey,
} from '../../../src/entrypoints/options/main';
import type { Settings, SettingsPatch } from '../../../src/storage/settings';
import { strings } from '../../../src/ui/strings';
import { clearApiKey, setApiKey } from '../../../src/storage/secrets';

const storageMocks = vi.hoisted(() => ({
  localData: {} as Record<string, unknown>,
  listeners: [] as Array<
    (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      area: string,
    ) => void
  >,
}));

vi.mock('wxt/browser', () => ({
  browser: {
    commands: { getAll: vi.fn(async () => []) },
    runtime: {
      id: 'test',
      getURL: (p: string) => `chrome-extension://test${p}`,
    },
    storage: {
      local: {
        get: vi.fn(
          async (keys?: string | string[] | Record<string, unknown> | null) => {
            if (keys === null || keys === undefined) {
              return { ...storageMocks.localData };
            }
            if (typeof keys === 'string') {
              return { [keys]: storageMocks.localData[keys] };
            }
            if (Array.isArray(keys)) {
              return Object.fromEntries(
                keys.map((key) => [key, storageMocks.localData[key]]),
              );
            }
            return { ...storageMocks.localData };
          },
        ),
        set: vi.fn(async (items: Record<string, unknown>) => {
          const changes: Record<
            string,
            { newValue?: unknown; oldValue?: unknown }
          > = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = {
              oldValue: storageMocks.localData[key],
              newValue: value,
            };
            storageMocks.localData[key] = value;
          }
          for (const listener of storageMocks.listeners) {
            listener(changes, 'local');
          }
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const changes: Record<
            string,
            { newValue?: unknown; oldValue?: unknown }
          > = {};
          for (const key of list) {
            changes[key] = {
              oldValue: storageMocks.localData[key],
              newValue: undefined,
            };
            delete storageMocks.localData[key];
          }
          for (const listener of storageMocks.listeners) {
            listener(changes, 'local');
          }
        }),
      },
      onChanged: {
        addListener: (listener: (typeof storageMocks.listeners)[number]) => {
          storageMocks.listeners.push(listener);
        },
        removeListener: (listener: (typeof storageMocks.listeners)[number]) => {
          storageMocks.listeners = storageMocks.listeners.filter(
            (item) => item !== listener,
          );
        },
      },
    },
  },
}));

function readSecrets(): Record<string, string> {
  const stored = storageMocks.localData['lp-secrets'];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return {};
  }
  return stored as Record<string, string>;
}

function writeSecrets(secrets: Record<string, string>) {
  storageMocks.localData['lp-secrets'] = secrets;
}

const DEFAULT_SETTINGS: Settings = {
  provider: null,
  targetLang: 'ko',
  autoSites: [],
  displayMode: 'bilingual',
  skipFixedBars: true,
  cache: { ttlDays: 90, maxMB: 20 },
};

const updateSettings = vi.fn(
  async (patch: SettingsPatch): Promise<Settings> => ({
    ...DEFAULT_SETTINGS,
    ...patch,
    cache: patch.cache
      ? { ...DEFAULT_SETTINGS.cache, ...patch.cache }
      : DEFAULT_SETTINGS.cache,
    autoSites: patch.autoSites ?? DEFAULT_SETTINGS.autoSites,
  }),
);
const getSettings = vi.fn(async (): Promise<Settings> => DEFAULT_SETTINGS);
const onSettingsChanged = vi.fn((listener: (settings: Settings) => void) => {
  void listener;
  return () => {};
});

function deps(overrides: Partial<OptionsDeps> = {}): OptionsDeps {
  return {
    uiRequest: vi.fn(async () => ({
      ok: true,
      models: ['model-a', 'free:free'],
    })),
    getSettings,
    updateSettings,
    onSettingsChanged,
    hasProviderAccess: vi.fn(async () => true),
    requestProviderAccess: vi.fn(async () => true),
    getCommands: vi.fn(async () => [
      { name: 'toggle-translate', shortcut: 'Alt+A' },
      { name: 'cycle-mode', shortcut: 'Alt+S' },
    ]),
    confirm: vi.fn(() => true),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  storageMocks.localData = {};
  storageMocks.listeners.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  document.body.innerHTML = '';
});

test('filterOptionsCommands drops entries without manifest command names', () => {
  expect(
    filterOptionsCommands([
      { name: 'toggle-translate', shortcut: 'Alt+A' },
      { name: '_execute_action' },
      { name: 'cycle-mode', shortcut: 'Alt+S' },
      { name: 'other' },
    ]),
  ).toEqual([
    { name: 'toggle-translate', shortcut: 'Alt+A' },
    { name: 'cycle-mode', shortcut: 'Alt+S' },
  ]);
});

test('helper guards provider base URLs', () => {
  expect(isHttpProviderBaseUrl('https://api.example.com/v1')).toBe(true);
  expect(isHttpProviderBaseUrl('ftp://api.example.com')).toBe(false);
  expect(isHttpProviderBaseUrl('https://user:pass@api.example.com')).toBe(
    false,
  );
});

test('filterOpenRouterModels keeps only :free models when requested', () => {
  expect(filterOpenRouterModels(['a:free', 'b:paid', 'c:free'], true)).toEqual([
    'a:free',
    'c:free',
  ]);
});

test('formatModelLabel marks free OpenRouter ids', () => {
  expect(formatModelLabel('x:free')).toContain('무료');
  expect(formatModelLabel('x:paid')).toBe('x:paid');
});

test('normalizeAutoSiteHostname lowercases and rejects paths or ports', () => {
  expect(normalizeAutoSiteHostname('  Example.COM  ')).toBe('example.com');
  expect(normalizeAutoSiteHostname('news.example.com/path')).toBeUndefined();
  expect(normalizeAutoSiteHostname('localhost:8080')).toBeUndefined();
  expect(normalizeAutoSiteHostname('https://example.com')).toBeUndefined();
});

test('parseCacheField requires positive finite numbers', () => {
  expect(parseCacheField('10')).toBe(10);
  expect(parseCacheField('0')).toBeUndefined();
  expect(parseCacheField('abc')).toBeUndefined();
});

test('pickDefaultModel prefers selectModelOptions order over raw list', () => {
  const available = ['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'];
  expect(pickDefaultModel('gemini', 'groq', available, false)).toBe(
    'gemini-3.1-pro-preview',
  );
});

test('listModelChoices filters OpenRouter free models', () => {
  expect(
    listModelChoices('preset', 'openrouter', ['a:free', 'b:paid'], true),
  ).toEqual(['a:free']);
});

test('buildProviderConfig uses the list-models probe without a selected model', () => {
  expect(
    buildProviderConfig({
      engine: 'gemini',
      apiKey: 'secret',
      model: '',
      baseUrl: '',
    }).model,
  ).toBe(LIST_MODELS_PROBE);
});

test('shows onboarding when provider is missing', () => {
  expect(showsOnboarding(null, undefined)).toBe(true);
  expect(
    showsOnboarding(
      {
        provider: 'openai',
        model: 'm',
      },
      'saved',
    ),
  ).toBe(false);
  expect(showsOnboarding({ provider: 'openai', model: 'm' }, undefined)).toBe(
    true,
  );
});

test('isEngineModelAllowed accepts listed native models', () => {
  expect(
    isEngineModelAllowed(
      'openai',
      'groq',
      'gpt-6-luna',
      ['gpt-6-luna', 'gpt-legacy'],
      false,
    ),
  ).toBe(true);
});

test('isEngineModelAllowed rejects preset models outside filtered choices', () => {
  expect(
    isEngineModelAllowed('preset', 'openrouter', 'paid:id', ['paid:id'], true),
  ).toBe(false);
  expect(
    isEngineModelAllowed('preset', 'openrouter', 'x:free', ['x:free'], true),
  ).toBe(true);
  expect(isEngineModelAllowed('custom', 'groq', 'any-id', [], false)).toBe(
    true,
  );
  expect(isEngineModelAllowed('openai', 'groq', 'm', [], false)).toBe(false);
});

test('modelSelectChoices shows saved model before listModels', () => {
  expect(modelSelectChoices([], [], 'saved-model')).toEqual(['saved-model']);
  expect(modelSelectChoices([], ['a'], 'saved-model')).toEqual(['a']);
  expect(modelSelectChoices(['listed'], [], 'saved-model')).toEqual([]);
});

test('buildProviderConfig trims custom baseUrl', () => {
  expect(
    buildProviderConfig({
      engine: 'custom',
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://api.example.com/v1  ',
    }).baseUrl,
  ).toBe('https://api.example.com/v1');
});

test('persistEngineSettings rejects OpenRouter free filter with no free models', async () => {
  const setApiKey = vi.fn(async () => {});
  const getApiKey = vi.fn(async () => undefined);
  const result = await persistEngineSettings(
    {
      updateSettings,
      hasProviderAccess: vi.fn(async () => true),
      setApiKey,
      getApiKey,
    },
    {
      engine: 'preset',
      presetId: 'openrouter',
      apiKey: 'k',
      model: 'vendor/paid',
      baseUrl: '',
      models: ['vendor/paid'],
      freeOnly: true,
    },
  );
  expect(result).toBe('invalid-model');
  expect(updateSettings).not.toHaveBeenCalled();
});

test('persistEngineSettings allows custom model not returned by listModels', async () => {
  const setApiKey = vi.fn(async () => {});
  const getApiKey = vi.fn(async () => undefined);
  await persistEngineSettings(
    {
      updateSettings,
      hasProviderAccess: vi.fn(async () => true),
      setApiKey,
      getApiKey,
    },
    {
      engine: 'custom',
      presetId: 'groq',
      apiKey: 'k',
      model: 'undeclared-model',
      baseUrl: 'https://api.example.com/v1',
      models: [],
      freeOnly: false,
    },
  );
  expect(updateSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: expect.objectContaining({
        provider: 'openai-compatible',
        model: 'undeclared-model',
      }),
    }),
  );
  expect(setApiKey).toHaveBeenCalledWith('openai-compatible', 'k');
});

test('persistEngineSettings stores empty custom api key separately from missing key', async () => {
  const setApiKey = vi.fn(async () => {});
  const getApiKey = vi.fn(async () => undefined);
  await persistEngineSettings(
    {
      updateSettings,
      hasProviderAccess: vi.fn(async () => true),
      setApiKey,
      getApiKey,
    },
    {
      engine: 'custom',
      presetId: 'groq',
      apiKey: '',
      model: 'local-model',
      baseUrl: 'http://localhost:11434/v1',
      models: [],
      freeOnly: false,
    },
  );
  expect(setApiKey).toHaveBeenCalledWith('openai-compatible', '');
  expect(updateSettings).toHaveBeenCalled();
});

test('persistEngineSettings rejects custom saves without permission', async () => {
  const setApiKey = vi.fn(async () => {});
  const getApiKey = vi.fn(async () => undefined);
  const result = await persistEngineSettings(
    {
      updateSettings,
      hasProviderAccess: vi.fn(async () => false),
      setApiKey,
      getApiKey,
    },
    {
      engine: 'custom',
      presetId: 'groq',
      apiKey: 'k',
      model: 'demo',
      baseUrl: 'https://api.example.com/v1',
      models: [],
      freeOnly: false,
    },
  );
  expect(result).toBe('permission');
  expect(updateSettings).not.toHaveBeenCalled();
});

test('persistEngineSettings rejects empty api key for native providers', async () => {
  const setApiKey = vi.fn(async () => {});
  const getApiKey = vi.fn(async () => undefined);
  const result = await persistEngineSettings(
    {
      updateSettings,
      hasProviderAccess: vi.fn(async () => true),
      setApiKey,
      getApiKey,
    },
    {
      engine: 'openai',
      presetId: 'groq',
      apiKey: '   ',
      model: 'gpt-test',
      baseUrl: '',
      models: ['gpt-test'],
      freeOnly: false,
    },
  );
  expect(result).toBe('invalid-key');
  expect(updateSettings).not.toHaveBeenCalled();
  expect(setApiKey).not.toHaveBeenCalled();
});

test('persistEngineSettings uses stored secret when draft key is blank', async () => {
  const setApiKey = vi.fn(async () => {});
  const getApiKey = vi.fn(async (id: string) =>
    id === 'openai' ? 'stored-openai' : undefined,
  );
  await persistEngineSettings(
    {
      updateSettings,
      hasProviderAccess: vi.fn(async () => true),
      setApiKey,
      getApiKey,
    },
    {
      engine: 'openai',
      presetId: 'groq',
      apiKey: '   ',
      model: 'gpt-6-luna',
      baseUrl: '',
      models: ['gpt-6-luna'],
      freeOnly: false,
    },
  );
  expect(setApiKey).toHaveBeenCalledWith('openai', 'stored-openai');
  expect(updateSettings).toHaveBeenCalledWith({
    provider: { provider: 'openai', model: 'gpt-6-luna' },
    preset: undefined,
  });
});

test('persistEngineSettings clears preset for native providers', async () => {
  const setApiKey = vi.fn(async () => {});
  const getApiKey = vi.fn(async () => undefined);
  await persistEngineSettings(
    {
      updateSettings,
      hasProviderAccess: vi.fn(async () => true),
      setApiKey,
      getApiKey,
    },
    {
      engine: 'openai',
      presetId: 'groq',
      apiKey: 'k',
      model: 'gpt-6-luna',
      baseUrl: '',
      models: ['gpt-6-luna', 'gpt-legacy'],
      freeOnly: false,
    },
  );
  expect(updateSettings).toHaveBeenCalledWith({
    provider: {
      provider: 'openai',
      model: 'gpt-6-luna',
    },
    preset: undefined,
  });
  expect(setApiKey).toHaveBeenCalledWith('openai', 'k');
});

test('validateProviderKey requires provider access before validateProvider', async () => {
  const order: string[] = [];
  const hasProviderAccess = vi.fn(async () => {
    order.push('check');
    return true;
  });
  const uiRequest = vi.fn(async () => {
    order.push('validate');
    return { ok: true, models: ['m1'] };
  });
  await validateProviderKey(
    { uiRequest, hasProviderAccess },
    {
      engine: 'preset',
      presetId: 'groq',
      apiKey: 'k',
      model: '',
      baseUrl: '',
    },
  );
  expect(order).toEqual(['check', 'validate']);
  expect(hasProviderAccess).toHaveBeenCalled();
});

test('validateProviderKey skips validate when permission denied', async () => {
  const uiRequest = vi.fn();
  const result = await validateProviderKey(
    {
      uiRequest,
      hasProviderAccess: vi.fn(async () => false),
    },
    {
      engine: 'custom',
      presetId: 'groq',
      apiKey: 'k',
      model: '',
      baseUrl: 'https://api.example.com/v1',
    },
  );
  expect(result).toEqual({ ok: false, reason: 'permission' });
  expect(uiRequest).not.toHaveBeenCalled();
});

test('providerFingerprint ignores language and cache fields', () => {
  const base = {
    provider: { provider: 'openai' as const, model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual' as const,
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  };
  expect(providerFingerprint({ ...base, targetLang: 'en' })).toBe(
    providerFingerprint(base),
  );
});

test('renders onboarding for an unconfigured install', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.onboardingFreeTitle),
  );
  expect(root.querySelector(`a[href*="openai.com"]`)).toBeTruthy();
});

test('updates onboarding when the saved provider key changes', async () => {
  getSettings.mockResolvedValue({
    ...DEFAULT_SETTINGS,
    provider: { provider: 'openai', model: 'm' },
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.onboardingFreeTitle),
  );
  await setApiKey('openai', 'saved');
  await vi.waitFor(() =>
    expect(root.textContent).not.toContain(strings.options.onboardingFreeTitle),
  );
  await clearApiKey('openai');
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.onboardingFreeTitle),
  );
});

test('shows load error when bootstrap requests fail', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <OptionsApp
      deps={deps({
        getSettings: vi.fn(async () => {
          throw new Error('fail');
        }),
      })}
    />,
    root,
  );
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.loadError),
  );
});

test('onSettingsChanged keeps unsaved api key when provider fingerprint matches', async () => {
  writeSecrets({ openai: 'saved' });
  const stored: Settings = {
    provider: { provider: 'openai', model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  };
  getSettings.mockResolvedValue(stored);
  let listener: ((settings: Settings) => void) | undefined;
  onSettingsChanged.mockImplementation((fn: (settings: Settings) => void) => {
    listener = fn;
    return () => {};
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).value).toBe(
      'saved',
    ),
  );
  const input = root.querySelector('#lp-api-key') as HTMLInputElement;
  input.value = 'draft-key';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  listener?.({ ...stored, targetLang: 'en' });
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).value).toBe(
      'draft-key',
    ),
  );
});

test('toggles API key visibility', async () => {
  writeSecrets({ openai: 'hidden-key' });
  getSettings.mockResolvedValue({
    provider: { provider: 'openai', model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  } satisfies Settings);
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect(
      root.querySelector(`button[aria-label="${strings.options.showKey}"]`),
    ).toBeTruthy(),
  );
  expect((root.querySelector('#lp-api-key') as HTMLInputElement).type).toBe(
    'password',
  );
  expect(
    root.querySelector('#lp-api-key')?.closest('.options__row')?.textContent,
  ).toContain(strings.options.validateKey);
  expect(
    root.querySelector('#lp-model')?.closest('.options__row')?.textContent,
  ).toContain(strings.options.save);
  expect(
    root
      .querySelector(`button[aria-label="${strings.options.showKey}"]`)
      ?.getAttribute('aria-pressed'),
  ).toBe('false');
  (
    root.querySelector(
      `button[aria-label="${strings.options.showKey}"]`,
    ) as HTMLButtonElement
  ).click();
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).type).toBe(
      'text',
    ),
  );
  const hide = root.querySelector(
    `button[aria-label="${strings.options.hideKey}"]`,
  ) as HTMLButtonElement;
  expect(hide.getAttribute('aria-pressed')).toBe('true');
  hide.click();
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).type).toBe(
      'password',
    ),
  );
});

test('keeps saved OpenRouter model before listModels', async () => {
  const savedModel = 'anthropic/claude-3.5-sonnet';
  getSettings.mockResolvedValue({
    provider: {
      provider: 'openai-compatible',
      model: savedModel,
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    preset: 'openrouter',
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  } satisfies Settings);
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() => {
    const select = root.querySelector('#lp-model') as HTMLSelectElement;
    expect(select?.value).toBe(savedModel);
  });
});

test('custom engine always uses text model input', async () => {
  getSettings.mockResolvedValue({
    provider: {
      provider: 'openai-compatible',
      model: 'custom-model',
      baseUrl: 'https://api.example.com/v1',
    },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  } satisfies Settings);
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-model') as HTMLInputElement).type).toBe(
      'text',
    ),
  );
});

test('skip fixed bars checkbox reflects settings and saves on toggle', async () => {
  getSettings.mockResolvedValue({
    ...DEFAULT_SETTINGS,
    skipFixedBars: true,
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() => {
    const checkbox = root.querySelector(
      '#lp-skip-fixed-bars',
    ) as HTMLInputElement;
    expect(checkbox?.checked).toBe(true);
  });
  const checkbox = root.querySelector(
    '#lp-skip-fixed-bars',
  ) as HTMLInputElement;
  checkbox.click();
  await vi.waitFor(() =>
    expect(updateSettings).toHaveBeenCalledWith({ skipFixedBars: false }),
  );
});

test('skip fixed bars checkbox starts unchecked when disabled in settings', async () => {
  getSettings.mockResolvedValue({
    ...DEFAULT_SETTINGS,
    skipFixedBars: false,
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() => {
    const checkbox = root.querySelector(
      '#lp-skip-fixed-bars',
    ) as HTMLInputElement;
    expect(checkbox?.checked).toBe(false);
  });
});

test('renders Korean command labels', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.commandToggleTranslate),
  );
});

test('delete stored key asks for confirmation and keeps provider settings', async () => {
  writeSecrets({ openai: 'secret-openai', gemini: 'secret-gemini' });
  const stored: Settings = {
    provider: { provider: 'openai', model: 'gpt-test' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  };
  getSettings.mockResolvedValue(stored);
  const confirm = vi.fn(() => true);
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps({ confirm })} />, root);
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).value).toBe(
      'secret-openai',
    ),
  );
  const deleteButton = [...root.querySelectorAll('button')].find(
    (node) => node.textContent === strings.options.deleteKey,
  );
  deleteButton?.click();
  expect(confirm).toHaveBeenCalledWith(
    strings.options.deleteKeyConfirm(strings.options.engineOpenai),
  );
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).value).toBe(
      '',
    ),
  );
  expect(readSecrets()).toEqual({ gemini: 'secret-gemini' });
  expect(updateSettings).not.toHaveBeenCalledWith(
    expect.objectContaining({ provider: null }),
  );
});

test('canceling delete key confirmation leaves lp-secrets unchanged', async () => {
  writeSecrets({ openai: 'keep-me' });
  getSettings.mockResolvedValue({
    provider: { provider: 'openai', model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  } satisfies Settings);
  const confirm = vi.fn(() => false);
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps({ confirm })} />, root);
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).value).toBe(
      'keep-me',
    ),
  );
  [...root.querySelectorAll('button')]
    .find((node) => node.textContent === strings.options.deleteKey)
    ?.click();
  expect(confirm).toHaveBeenCalled();
  expect(readSecrets()).toEqual({ openai: 'keep-me' });
});

test('switching engines restores each provider secret from lp-secrets', async () => {
  writeSecrets({ openai: 'openai-key', gemini: 'gemini-key' });
  getSettings.mockResolvedValue({
    provider: { provider: 'openai', model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  } satisfies Settings);
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).value).toBe(
      'openai-key',
    ),
  );
  const engineSelect = root.querySelector('#lp-engine') as HTMLSelectElement;
  engineSelect.value = 'gemini';
  engineSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).value).toBe(
      'gemini-key',
    ),
  );
  engineSelect.value = 'openai';
  engineSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() =>
    expect((root.querySelector('#lp-api-key') as HTMLInputElement).value).toBe(
      'openai-key',
    ),
  );
});

test('clear all keys removes lp-secrets but keeps provider metadata', async () => {
  writeSecrets({ openai: 'one', gemini: 'two', groq: 'three' });
  const stored: Settings = {
    provider: { provider: 'openai', model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
    skipFixedBars: true,
    cache: { ttlDays: 90, maxMB: 20 },
  };
  getSettings.mockResolvedValue(stored);
  const confirm = vi.fn(() => true);
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps({ confirm })} />, root);
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.clearAllKeys),
  );
  [...root.querySelectorAll('button')]
    .find((node) => node.textContent === strings.options.clearAllKeys)
    ?.click();
  expect(confirm).toHaveBeenCalledWith(strings.options.clearAllKeysConfirm);
  await vi.waitFor(() => expect(readSecrets()).toEqual({}));
  expect(updateSettings).not.toHaveBeenCalledWith(
    expect.objectContaining({ provider: null }),
  );
});

test('shows API access button when provider permission is missing', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <OptionsApp deps={deps({ hasProviderAccess: vi.fn(async () => false) })} />,
    root,
  );
  await vi.waitFor(() => expect(root.querySelector('#lp-engine')).toBeTruthy());
  const engineSelect = root.querySelector('#lp-engine') as HTMLSelectElement;
  engineSelect.value = 'preset:groq';
  engineSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.allowApiAccess),
  );
});

test('API access button requests provider permission on click', async () => {
  let granted = false;
  const requestProviderAccess = vi.fn(async () => {
    granted = true;
    return true;
  });
  const hasProviderAccess = vi.fn(async () => granted);
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <OptionsApp deps={deps({ hasProviderAccess, requestProviderAccess })} />,
    root,
  );
  await vi.waitFor(() => expect(root.querySelector('#lp-engine')).toBeTruthy());
  const engineSelect = root.querySelector('#lp-engine') as HTMLSelectElement;
  engineSelect.value = 'preset:groq';
  engineSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.allowApiAccess),
  );
  [...root.querySelectorAll('button')]
    .find((node) => node.textContent === strings.options.allowApiAccess)
    ?.click();
  await vi.waitFor(() =>
    expect(requestProviderAccess).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\//),
    ),
  );
});

test('hides API access button when provider permission is granted', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.validateKey),
  );
  expect(root.textContent).not.toContain(strings.options.allowApiAccess);
});

test('renders usage totals and clears records after confirmation', async () => {
  const date = new Date();
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const request: OptionsDeps['uiRequest'] = vi.fn(async (message) =>
    message.type === 'getUsage'
      ? {
          ok: true,
          tokenUsage: {
            [day]: {
              openai: {
                model: { requests: 2, inputTokens: 123, outputTokens: 45 },
              },
            },
          },
        }
      : { ok: true },
  );
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps({ uiRequest: request })} />, root);
  await vi.waitFor(() =>
    expect(root.querySelector('#usage')?.textContent).toContain(
      '오늘: 요청 2 · 입력 123 · 출력 45',
    ),
  );
  expect(root.querySelector('#usage table')?.textContent).toContain('openai');
  [...root.querySelectorAll('button')]
    .find((button) => button.textContent === strings.options.usageClear)
    ?.click();
  await vi.waitFor(() =>
    expect(root.querySelector('#usage')?.textContent).toContain('오늘: 요청 0'),
  );
  expect(request).toHaveBeenCalledWith({ type: 'clearUsage' });
});
