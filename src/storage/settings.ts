import { browser } from 'wxt/browser';
import { PRESETS, type PresetId } from '../providers/presets';
import type { ProviderConfig, ProviderId } from '../providers/types';

export interface Settings {
  provider: ProviderConfig | null;
  preset?: PresetId;
  targetLang: string;
  skipFixedBars: boolean;
  autoSites: string[];
  displayMode: 'bilingual' | 'translation' | 'original';
  cache: { ttlDays: number; maxMB: number };
}

export type SettingsPatch = Omit<Partial<Settings>, 'cache'> & {
  cache?: Partial<Settings['cache']>;
};

const STORAGE_KEY = 'lp-settings';

const PROVIDER_IDS: ProviderId[] = [
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
];

const PRESET_IDS: PresetId[] = PRESETS.map((preset) => preset.id);

const DISPLAY_MODES: Settings['displayMode'][] = [
  'bilingual',
  'translation',
  'original',
];

export const DEFAULT_SETTINGS: Settings = {
  provider: null,
  targetLang: 'ko',
  skipFixedBars: true,
  autoSites: [],
  displayMode: 'bilingual',
  cache: { ttlDays: 90, maxMB: 20 },
};

const listeners = new Set<(settings: Settings) => void>();
let storageListenerReady = false;
let writeQueue: Promise<void> = Promise.resolve();

function cloneCache(cache: Settings['cache']): Settings['cache'] {
  return { ttlDays: cache.ttlDays, maxMB: cache.maxMB };
}

function cloneSettings(settings: Settings): Settings {
  const cloned: Settings = {
    provider: settings.provider ? { ...settings.provider } : null,
    targetLang: settings.targetLang,
    skipFixedBars: settings.skipFixedBars,
    autoSites: [...settings.autoSites],
    displayMode: settings.displayMode,
    cache: cloneCache(settings.cache),
  };
  if (settings.preset) cloned.preset = settings.preset;
  return cloned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseProvider(value: unknown): ProviderConfig | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const provider = value.provider;
  if (
    typeof provider !== 'string' ||
    !PROVIDER_IDS.includes(provider as ProviderId)
  )
    return null;
  if (typeof value.apiKey !== 'string') return null;
  if (value.apiKey === '' && provider !== 'openai-compatible') return null;
  if (typeof value.model !== 'string' || value.model.trim() === '') return null;
  const cfg: ProviderConfig = {
    provider: provider as ProviderId,
    apiKey: value.apiKey,
    model: value.model,
  };
  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== 'string' || !isHttpUrl(value.baseUrl))
      return null;
    cfg.baseUrl = value.baseUrl;
  }
  return cfg;
}

function parsePreset(value: unknown): PresetId | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && PRESET_IDS.includes(value as PresetId)
    ? (value as PresetId)
    : undefined;
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.every((item) => typeof item === 'string')
    ? [...value]
    : [...fallback];
}

function parseDisplayMode(value: unknown): Settings['displayMode'] {
  return typeof value === 'string' &&
    DISPLAY_MODES.includes(value as Settings['displayMode'])
    ? (value as Settings['displayMode'])
    : DEFAULT_SETTINGS.displayMode;
}

function parseCache(
  value: unknown,
  fallback: Settings['cache'] = DEFAULT_SETTINGS.cache,
): Settings['cache'] {
  if (!isRecord(value)) return cloneCache(fallback);
  const ttlDays =
    typeof value.ttlDays === 'number' &&
    Number.isFinite(value.ttlDays) &&
    value.ttlDays > 0
      ? value.ttlDays
      : fallback.ttlDays;
  const maxMB =
    typeof value.maxMB === 'number' &&
    Number.isFinite(value.maxMB) &&
    value.maxMB > 0
      ? value.maxMB
      : fallback.maxMB;
  return { ttlDays, maxMB };
}

export function normalizeSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return cloneSettings(DEFAULT_SETTINGS);
  const settings: Settings = {
    provider:
      raw.provider === null
        ? null
        : (parseProvider(raw.provider) ?? DEFAULT_SETTINGS.provider),
    targetLang:
      typeof raw.targetLang === 'string' && raw.targetLang.trim() !== ''
        ? raw.targetLang
        : DEFAULT_SETTINGS.targetLang,
    skipFixedBars:
      typeof raw.skipFixedBars === 'boolean' ? raw.skipFixedBars : true,
    autoSites: parseStringArray(raw.autoSites, DEFAULT_SETTINGS.autoSites),
    displayMode: parseDisplayMode(raw.displayMode),
    cache: parseCache(raw.cache),
  };
  const preset = parsePreset(raw.preset);
  if (preset) settings.preset = preset;
  return cloneSettings(settings);
}

function ensureStorageListener(): void {
  if (storageListenerReady) return;
  storageListenerReady = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    const next = normalizeSettings(change.newValue);
    for (const listener of listeners) listener(next);
  });
}

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return normalizeSettings(stored[STORAGE_KEY]);
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return enqueueWrite(async () => {
    const current = await getSettings();
    const next = normalizeSettings({
      ...current,
      ...patch,
      ...(patch.cache !== undefined
        ? {
            cache: parseCache(
              { ...current.cache, ...patch.cache },
              current.cache,
            ),
          }
        : {}),
      ...(patch.provider !== undefined
        ? {
            provider:
              patch.provider === null ? null : parseProvider(patch.provider),
          }
        : {}),
      ...(patch.preset !== undefined
        ? { preset: parsePreset(patch.preset) }
        : {}),
    });
    await browser.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
}

export function onSettingsChanged(
  listener: (settings: Settings) => void,
): () => void {
  ensureStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
