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

vi.mock('wxt/browser', () => ({
  browser: {
    commands: { getAll: vi.fn(async () => []) },
    runtime: { id: 'test', getURL: (p: string) => `chrome-extension://test${p}` },
  },
}));

const DEFAULT_SETTINGS: Settings = {
  provider: null,
  targetLang: 'ko',
  autoSites: [],
  displayMode: 'bilingual',
  cache: { ttlDays: 90, maxMB: 20 },
};

const updateSettings = vi.fn(
  async (patch: SettingsPatch): Promise<Settings> => ({
    ...DEFAULT_SETTINGS,
    ...patch,
    cache: patch.cache ? { ...DEFAULT_SETTINGS.cache, ...patch.cache } : DEFAULT_SETTINGS.cache,
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
    uiRequest: vi.fn(async () => ({ ok: true, models: ['model-a', 'free:free'] })),
    getSettings,
    updateSettings,
    onSettingsChanged,
    requestProviderPermission: vi.fn(async () => true),
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
  expect(isHttpProviderBaseUrl('https://user:pass@api.example.com')).toBe(false);
});

test('filterOpenRouterModels keeps only :free models when requested', () => {
  expect(
    filterOpenRouterModels(['a:free', 'b:paid', 'c:free'], true),
  ).toEqual(['a:free', 'c:free']);
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
  const available = [
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
  ];
  expect(pickDefaultModel('gemini', 'groq', available, false)).toBe(
    'gemini-3.1-pro-preview',
  );
});

test('listModelChoices filters OpenRouter free models', () => {
  expect(
    listModelChoices(
      'preset',
      'openrouter',
      ['a:free', 'b:paid'],
      true,
    ),
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
  expect(showsOnboarding(null)).toBe(true);
  expect(
    showsOnboarding({
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
    }),
  ).toBe(false);
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
  expect(isEngineModelAllowed('custom', 'groq', 'any-id', [], false)).toBe(true);
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
  const result = await persistEngineSettings(
    {
      updateSettings,
      requestProviderPermission: vi.fn(async () => true),
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
  await persistEngineSettings(
    {
      updateSettings,
      requestProviderPermission: vi.fn(async () => true),
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
      provider: expect.objectContaining({ model: 'undeclared-model' }),
    }),
  );
});

test('persistEngineSettings rejects custom saves without permission', async () => {
  const result = await persistEngineSettings(
    {
      updateSettings,
      requestProviderPermission: vi.fn(async () => false),
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
  const result = await persistEngineSettings(
    {
      updateSettings,
      requestProviderPermission: vi.fn(async () => true),
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
});

test('persistEngineSettings clears preset for native providers', async () => {
  await persistEngineSettings(
    {
      updateSettings,
      requestProviderPermission: vi.fn(async () => true),
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
      apiKey: 'k',
      model: 'gpt-6-luna',
    },
    preset: undefined,
  });
});

test('validateProviderKey requests preset permission before validateProvider', async () => {
  const order: string[] = [];
  const requestProviderPermission = vi.fn(async () => {
    order.push('permission');
    return true;
  });
  const uiRequest = vi.fn(async () => {
    order.push('validate');
    return { ok: true, models: ['m1'] };
  });
  await validateProviderKey(
    { uiRequest, requestProviderPermission },
    {
      engine: 'preset',
      presetId: 'groq',
      apiKey: 'k',
      model: '',
      baseUrl: '',
    },
  );
  expect(order).toEqual(['permission', 'validate']);
  expect(requestProviderPermission).toHaveBeenCalled();
});

test('validateProviderKey skips validate when permission denied', async () => {
  const uiRequest = vi.fn();
  const result = await validateProviderKey(
    {
      uiRequest,
      requestProviderPermission: vi.fn(async () => false),
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
    provider: { provider: 'openai' as const, apiKey: 'a', model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual' as const,
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
  const stored: Settings = {
    provider: { provider: 'openai', apiKey: 'saved', model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
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
  getSettings.mockResolvedValue({
    provider: { provider: 'openai', apiKey: 'secret', model: 'm' },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
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
});

test('keeps saved OpenRouter model before listModels', async () => {
  const savedModel = 'anthropic/claude-3.5-sonnet';
  getSettings.mockResolvedValue({
    provider: {
      provider: 'openai-compatible',
      apiKey: 'saved-key',
      model: savedModel,
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    preset: 'openrouter',
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
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
      apiKey: 'k',
      model: 'custom-model',
      baseUrl: 'https://api.example.com/v1',
    },
    targetLang: 'ko',
    autoSites: [],
    displayMode: 'bilingual',
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

test('renders Korean command labels', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<OptionsApp deps={deps()} />, root);
  await vi.waitFor(() =>
    expect(root.textContent).toContain(strings.options.commandToggleTranslate),
  );
});
