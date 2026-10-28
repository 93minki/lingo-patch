import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { selectModelOptions } from '../../providers/models';
import { isFreeModel, PRESETS, type PresetId } from '../../providers/presets';
import type { ProviderConfig } from '../../providers/types';
import { uiRequest, type UiRequest, type UiResponse } from '../../messaging/extension';
import type { DisplayMode } from '../../messaging/types';
import { requestProviderPermission } from '../../platform/permissions';
import {
  getSettings,
  onSettingsChanged,
  updateSettings,
  type Settings,
  type SettingsPatch,
} from '../../storage/settings';
import { KEY_LINKS, SHORTCUTS_HELP_URL } from '../../ui/key-links';
import { commandLabel, strings } from '../../ui/strings';
import './options.css';

export const LIST_MODELS_PROBE = '__list_models__';

export type EngineKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'preset'
  | 'custom';

export function isHttpProviderBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function filterOpenRouterModels(
  models: string[],
  freeOnly: boolean,
): string[] {
  return freeOnly ? models.filter((id) => isFreeModel(id)) : models;
}

export function formatModelLabel(id: string): string {
  return isFreeModel(id) ? `${id} (무료)` : id;
}

export function listModelChoices(
  engine: EngineKind,
  presetId: PresetId,
  models: string[],
  freeOnly: boolean,
): string[] {
  if (engine === 'custom') return [];
  if (engine === 'preset' && presetId === 'openrouter')
    return filterOpenRouterModels(models, freeOnly);
  if (engine === 'preset') return models;
  if (engine === 'openai' || engine === 'anthropic' || engine === 'gemini')
    return selectModelOptions(engine, models).map((option) => option.id);
  return models;
}

export function pickDefaultModel(
  engine: EngineKind,
  presetId: PresetId,
  models: string[],
  freeOnly: boolean,
): string | undefined {
  return listModelChoices(engine, presetId, models, freeOnly)[0];
}

/** native/preset: model must appear in current choices after listModels; custom: any non-empty id. */
export function isEngineModelAllowed(
  engine: EngineKind,
  presetId: PresetId,
  model: string,
  models: string[],
  freeOnly: boolean,
): boolean {
  const trimmed = model.trim();
  if (!trimmed) return false;
  if (engine === 'custom') return true;
  const allowed = listModelChoices(engine, presetId, models, freeOnly);
  if (allowed.length === 0) return false;
  return allowed.includes(trimmed);
}

export function modelSelectChoices(
  listedModels: string[],
  modelChoices: string[],
  savedModel: string,
): string[] {
  if (modelChoices.length > 0) return modelChoices;
  if (listedModels.length > 0) return [];
  const saved = savedModel.trim();
  return saved ? [saved] : [];
}

export function permissionBaseUrl(
  engine: EngineKind,
  presetId: PresetId,
  baseUrl: string,
): string | undefined {
  if (engine === 'custom') return baseUrl.trim();
  if (engine === 'preset')
    return PRESETS.find((item) => item.id === presetId)?.baseUrl;
  return undefined;
}

export function normalizeAutoSiteHostname(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.includes('/') || trimmed.includes(':')) return undefined;
  if (trimmed.includes('://')) return undefined;
  return trimmed;
}

export function providerFingerprint(settings: Settings): string {
  const provider = settings.provider;
  if (!provider) return 'none';
  return [
    settings.preset ?? '',
    provider.provider,
    provider.baseUrl ?? '',
    provider.model,
    provider.apiKey,
  ].join('|');
}

export function parseCacheField(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

const OPTIONS_COMMAND_NAMES = new Set(['toggle-translate', 'cycle-mode']);

export function filterOptionsCommands(
  commands: { name?: string; shortcut?: string }[],
): { name?: string; shortcut?: string }[] {
  return commands.filter(
    (command) => command.name && OPTIONS_COMMAND_NAMES.has(command.name),
  );
}

export function showsOnboarding(provider: Settings['provider']): boolean {
  return provider === null;
}

export function inferEngine(settings: Settings): {
  engine: EngineKind;
  presetId?: PresetId;
} {
  if (settings.preset) return { engine: 'preset', presetId: settings.preset };
  const provider = settings.provider?.provider;
  if (provider === 'openai-compatible') return { engine: 'custom' };
  if (
    provider === 'openai' ||
    provider === 'anthropic' ||
    provider === 'gemini'
  )
    return { engine: provider };
  return { engine: 'gemini' };
}

export type PersistResult =
  | 'saved'
  | 'permission'
  | 'invalid-model'
  | 'invalid-url'
  | 'invalid-key';

export async function persistEngineSettings(
  deps: Pick<OptionsDeps, 'requestProviderPermission' | 'updateSettings'>,
  input: {
    engine: EngineKind;
    presetId: PresetId;
    apiKey: string;
    model: string;
    baseUrl: string;
    models: string[];
    freeOnly: boolean;
  },
): Promise<PersistResult> {
  const permissionUrl = permissionBaseUrl(
    input.engine,
    input.presetId,
    input.baseUrl,
  );
  if (permissionUrl !== undefined) {
    if (!isHttpProviderBaseUrl(permissionUrl)) return 'invalid-url';
    const granted = await deps.requestProviderPermission(permissionUrl);
    if (!granted) return 'permission';
  }
  if (input.engine !== 'custom' && !input.apiKey.trim()) return 'invalid-key';
  const model = input.model.trim();
  if (
    !isEngineModelAllowed(
      input.engine,
      input.presetId,
      model,
      input.models,
      input.freeOnly,
    )
  ) {
    return 'invalid-model';
  }
  const provider = buildProviderConfig({ ...input, model });
  if (input.engine === 'preset') {
    await deps.updateSettings({ provider, preset: input.presetId });
  } else {
    await deps.updateSettings({ provider, preset: undefined });
  }
  return 'saved';
}

export async function validateProviderKey(
  deps: Pick<OptionsDeps, 'uiRequest' | 'requestProviderPermission'>,
  input: {
    engine: EngineKind;
    presetId: PresetId;
    apiKey: string;
    model: string;
    baseUrl: string;
  },
): Promise<
  | { ok: true; models: string[] }
  | {
      ok: false;
      reason: 'permission' | 'invalid-url' | 'validation';
      error?: UiResponse['error'];
    }
> {
  const permissionUrl = permissionBaseUrl(
    input.engine,
    input.presetId,
    input.baseUrl,
  );
  if (permissionUrl !== undefined) {
    if (!isHttpProviderBaseUrl(permissionUrl)) {
      return { ok: false, reason: 'invalid-url' };
    }
    const granted = await deps.requestProviderPermission(permissionUrl);
    if (!granted) return { ok: false, reason: 'permission' };
  }
  const response = await deps.uiRequest({
    type: 'validateProvider',
    cfg: buildProviderConfig(input),
  });
  if (!response.ok || !response.models) {
    return { ok: false, reason: 'validation', error: response.error };
  }
  return { ok: true, models: response.models };
}

export function buildProviderConfig(input: {
  engine: EngineKind;
  presetId?: PresetId;
  apiKey: string;
  model: string;
  baseUrl: string;
}): ProviderConfig {
  if (input.engine === 'preset') {
    const preset = PRESETS.find((item) => item.id === input.presetId)!;
    return {
      provider: 'openai-compatible',
      apiKey: input.apiKey,
      model: input.model || LIST_MODELS_PROBE,
      baseUrl: preset.baseUrl,
    };
  }
  if (input.engine === 'custom') {
    return {
      provider: 'openai-compatible',
      apiKey: input.apiKey,
      model: input.model || LIST_MODELS_PROBE,
      baseUrl: input.baseUrl.trim(),
    };
  }
  return {
    provider: input.engine,
    apiKey: input.apiKey,
    model: input.model || LIST_MODELS_PROBE,
  };
}

export type OptionsDeps = {
  uiRequest: (request: UiRequest) => Promise<UiResponse>;
  getSettings: typeof getSettings;
  updateSettings: typeof updateSettings;
  onSettingsChanged: typeof onSettingsChanged;
  requestProviderPermission: typeof requestProviderPermission;
  getCommands: () => Promise<{ name?: string; shortcut?: string }[]>;
  confirm: (message: string) => boolean;
};

const TARGET_LANGS = [
  { id: 'ko', label: strings.options.langKo },
  { id: 'en', label: strings.options.langEn },
  { id: 'ja', label: strings.options.langJa },
  { id: 'zh-CN', label: strings.options.langZh },
];

const DISPLAY_MODES: { id: DisplayMode; label: string }[] = [
  { id: 'bilingual', label: strings.popup.modeBilingual },
  { id: 'translation', label: strings.popup.modeTranslation },
  { id: 'original', label: strings.popup.modeOriginal },
];

function validationMessage(error?: UiResponse['error']): string {
  if (error === 'auth') return strings.options.validationAuth;
  if (error === 'network') return strings.options.validationNetwork;
  return strings.options.validationOther;
}

export function OptionsApp({ deps }: { deps: OptionsDeps }) {
  const [settings, setSettings] = useState<Settings | undefined>();
  const [engine, setEngine] = useState<EngineKind>('gemini');
  const [presetId, setPresetId] = useState<PresetId>('groq');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [siteDraft, setSiteDraft] = useState('');
  const [deleteOrigin, setDeleteOrigin] = useState('');
  const [usage, setUsage] = useState<{ count: number; bytes: number }>();
  const [commands, setCommands] = useState<
    { name?: string; shortcut?: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [retryToken, setRetryToken] = useState(0);
  const syncedFingerprint = useRef('');

  const resetEngineDraft = () => {
    setApiKey('');
    setModel('');
    setBaseUrl('');
    setModels([]);
    setMessage(undefined);
    setError(undefined);
  };

  const syncEngineForm = (next: Settings) => {
    const inferred = inferEngine(next);
    setEngine(inferred.engine);
    if (inferred.presetId) setPresetId(inferred.presetId);
    setApiKey(next.provider?.apiKey ?? '');
    setModel(next.provider?.model ?? '');
    setBaseUrl(next.provider?.baseUrl ?? '');
    setModels([]);
    syncedFingerprint.current = providerFingerprint(next);
  };

  const refreshCacheUsage = async () => {
    const response = await deps.uiRequest({ type: 'cacheUsage' });
    if (response.ok && response.usage) setUsage(response.usage);
  };

  useEffect(() => {
    let alive = true;
    setLoadError(undefined);
    void Promise.all([
      deps.getSettings(),
      deps.uiRequest({ type: 'cacheUsage' }),
      deps.getCommands(),
    ])
      .then(([next, usageResponse, commandList]) => {
        if (!alive) return;
        setSettings(next);
        syncEngineForm(next);
        if (usageResponse.ok && usageResponse.usage)
          setUsage(usageResponse.usage);
        setCommands(commandList);
      })
      .catch(() => {
        if (!alive) return;
        setLoadError(strings.options.loadError);
      });
    const stop = deps.onSettingsChanged((next) => {
      if (!alive) return;
      setSettings(next);
      if (providerFingerprint(next) !== syncedFingerprint.current) {
        syncEngineForm(next);
      }
    });
    return () => {
      alive = false;
      stop();
    };
  }, [deps, retryToken]);

  const cachePercent = useMemo(() => {
    if (!settings || !usage) return 0;
    const maxBytes = settings.cache.maxMB * 1024 * 1024;
    return maxBytes ? Math.round((usage.bytes / maxBytes) * 100) : 0;
  }, [settings, usage]);

  const modelChoices = useMemo(
    () => listModelChoices(engine, presetId, models, freeOnly),
    [engine, presetId, models, freeOnly],
  );

  const fetchedModels = models.length > 0;
  const selectChoices = useMemo(
    () => modelSelectChoices(models, modelChoices, model),
    [models, modelChoices, model],
  );

  useEffect(() => {
    if (
      engine === 'preset' &&
      presetId === 'openrouter' &&
      model &&
      !modelChoices.includes(model)
    ) {
      setModel('');
    }
  }, [engine, presetId, freeOnly, model, modelChoices]);

  const validateKey = async () => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await validateProviderKey(deps, {
        engine,
        presetId,
        apiKey,
        model,
        baseUrl,
      });
      if (!result.ok) {
        if (result.reason === 'permission') {
          setError(strings.options.permissionDenied);
        } else if (result.reason === 'invalid-url') {
          setError(strings.options.validationOther);
        } else {
          setError(validationMessage(result.error));
        }
        return;
      }
      if (result.models.length === 0) {
        setModels([]);
        setModel('');
        setError(strings.options.pickModel);
        return;
      }
      setModels(result.models);
      const picked = pickDefaultModel(engine, presetId, result.models, freeOnly);
      if (picked) setModel(picked);
      setMessage(strings.options.validateOk);
    } catch {
      setError(strings.options.requestFailed);
    } finally {
      setBusy(false);
    }
  };

  const saveEngine = async () => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await persistEngineSettings(deps, {
        engine,
        presetId,
        apiKey,
        model,
        baseUrl,
        models,
        freeOnly,
      });
      if (result === 'permission') {
        setError(strings.options.permissionDenied);
        return;
      }
      if (result === 'invalid-key') {
        setError(strings.options.invalidKey);
        return;
      }
      if (result === 'invalid-url' || result === 'invalid-model') {
        setError(
          result === 'invalid-model'
            ? strings.options.pickModel
            : strings.options.validationOther,
        );
        return;
      }
      setMessage(strings.options.saved);
      const next = await deps.getSettings();
      syncedFingerprint.current = providerFingerprint(next);
    } catch {
      setError(strings.options.requestFailed);
    } finally {
      setBusy(false);
    }
  };

  const saveGeneral = async (patch: SettingsPatch) => {
    setBusy(true);
    setError(undefined);
    try {
      await deps.updateSettings(patch);
      setMessage(strings.options.saved);
    } catch {
      setError(strings.options.requestFailed);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <main class="options">
        <h1>{strings.options.title}</h1>
        <p class="options__error">{loadError}</p>
        <button
          type="button"
          class="options__btn options__btn--primary"
          onClick={() => setRetryToken((value) => value + 1)}
        >
          {strings.options.retry}
        </button>
      </main>
    );
  }

  if (!settings) {
    return (
      <main class="options">
        <h1>{strings.options.title}</h1>
        <p>{strings.options.loading}</p>
      </main>
    );
  }

  return (
    <main class="options" aria-busy={busy}>
      <h1>{strings.options.title}</h1>
      {error ? <p class="options__error">{error}</p> : null}
      {message ? <p class="options__success">{message}</p> : null}

      {showsOnboarding(settings.provider) ? (
        <section class="options__onboarding" aria-label={strings.options.onboardingFreeTitle}>
          <h2>{strings.options.onboardingFreeTitle}</h2>
          <ol>
            <li>{strings.options.onboardingFreeGemini1}</li>
            <li>{strings.options.onboardingFreeGemini2}</li>
            <li>{strings.options.onboardingFreeGemini3}</li>
          </ol>
          <p class="options__notice">
            <a href={KEY_LINKS.gemini.signup} target="_blank" rel="noreferrer">
              Gemini
            </a>
            {' · '}
            <a href={KEY_LINKS.groq.signup} target="_blank" rel="noreferrer">
              Groq
            </a>
            {' · '}
            <a href={KEY_LINKS.openrouter.signup} target="_blank" rel="noreferrer">
              OpenRouter
            </a>
          </p>
          <p class="options__notice">{strings.options.freeTierNotice}</p>
          <h2>{strings.options.onboardingPaidTitle}</h2>
          <p class="options__notice">
            <a href={KEY_LINKS.openai.signup} target="_blank" rel="noreferrer">
              OpenAI
            </a>
            {' · '}
            <a href={KEY_LINKS.anthropic.signup} target="_blank" rel="noreferrer">
              Anthropic
            </a>
            {' · '}
            <a href={KEY_LINKS.deepseek.signup} target="_blank" rel="noreferrer">
              DeepSeek
            </a>
          </p>
        </section>
      ) : null}

      <section aria-label={strings.options.engine}>
        <h2>{strings.options.engine}</h2>
        <label for="lp-engine">{strings.options.engine}</label>
        <select
          id="lp-engine"
          value={engine === 'preset' ? `preset:${presetId}` : engine}
          disabled={busy}
          onChange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            resetEngineDraft();
            if (value.startsWith('preset:')) {
              setEngine('preset');
              setPresetId(value.slice(7) as PresetId);
              return;
            }
            setEngine(value as EngineKind);
          }}
        >
          <option value="gemini">{strings.options.engineGemini}</option>
          <option value="openai">{strings.options.engineOpenai}</option>
          <option value="anthropic">{strings.options.engineAnthropic}</option>
          <option value="preset:deepseek">{strings.options.engineDeepseek}</option>
          <option value="preset:groq">{strings.options.engineGroq}</option>
          <option value="preset:openrouter">{strings.options.engineOpenrouter}</option>
          <option value="custom">{strings.options.engineCustom}</option>
        </select>

        <label for="lp-api-key">{strings.options.apiKey}</label>
        <div class="options__row">
          {showKey ? (
            <input
              id="lp-api-key"
              type="text"
              value={apiKey}
              autoComplete="off"
              disabled={busy}
              onInput={(event) =>
                setApiKey((event.currentTarget as HTMLInputElement).value)
              }
            />
          ) : (
            <input
              id="lp-api-key"
              type="password"
              value={apiKey}
              autoComplete="off"
              disabled={busy}
              onInput={(event) =>
                setApiKey((event.currentTarget as HTMLInputElement).value)
              }
            />
          )}
          <button
            type="button"
            class="options__btn"
            disabled={busy}
            aria-label={showKey ? strings.options.hideKey : strings.options.showKey}
            onClick={() => setShowKey((value) => !value)}
          >
            {showKey ? strings.options.hideKey : strings.options.showKey}
          </button>
        </div>

        {engine === 'custom' ? (
          <>
            <label for="lp-base-url">{strings.options.baseUrl}</label>
            <input
              id="lp-base-url"
              type="url"
              value={baseUrl}
              disabled={busy}
              onInput={(event) =>
                setBaseUrl((event.currentTarget as HTMLInputElement).value)
              }
            />
          </>
        ) : null}

        {engine === 'preset' && presetId === 'openrouter' ? (
          <label class="options__row">
            <input
              type="checkbox"
              checked={freeOnly}
              disabled={busy}
              onChange={(event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                setFreeOnly(checked);
                if (
                  model &&
                  !filterOpenRouterModels(models, checked).includes(model)
                ) {
                  setModel('');
                }
              }}
            />
            {strings.options.freeModelsOnly}
          </label>
        ) : null}

        <label for="lp-model">{strings.options.model}</label>
        {engine === 'custom' ? (
          <input
            id="lp-model"
            type="text"
            value={model}
            disabled={busy}
            onInput={(event) =>
              setModel((event.currentTarget as HTMLInputElement).value)
            }
          />
        ) : selectChoices.length ? (
          <select
            id="lp-model"
            value={model}
            disabled={busy || !fetchedModels}
            onChange={(event) =>
              setModel((event.currentTarget as HTMLSelectElement).value)
            }
          >
            {selectChoices.map((id) => (
              <option value={id}>{formatModelLabel(id)}</option>
            ))}
          </select>
        ) : (
          <>
            <select id="lp-model" disabled>
              <option value="">{strings.options.validateModelsFirst}</option>
            </select>
            <p class="options__notice">{strings.options.validateModelsFirst}</p>
          </>
        )}

        <div class="options__row">
          <button
            type="button"
            class="options__btn"
            disabled={busy}
            onClick={() => void validateKey()}
          >
            {busy ? strings.options.validating : strings.options.validateKey}
          </button>
          <button
            type="button"
            class="options__btn options__btn--primary"
            disabled={busy}
            onClick={() => void saveEngine()}
          >
            {strings.options.save}
          </button>
        </div>
        <p class="options__notice">{strings.options.privacy}</p>
      </section>

      <section aria-label={strings.options.translation}>
        <h2>{strings.options.translation}</h2>
        <label for="lp-target-lang">{strings.options.targetLang}</label>
        <select
          id="lp-target-lang"
          value={settings.targetLang}
          disabled={busy}
          onChange={(event) =>
            void saveGeneral({
              targetLang: (event.currentTarget as HTMLSelectElement).value,
            })
          }
        >
          {TARGET_LANGS.map((lang) => (
            <option value={lang.id}>{lang.label}</option>
          ))}
        </select>
        <label for="lp-display-mode">{strings.options.defaultDisplayMode}</label>
        <select
          id="lp-display-mode"
          value={settings.displayMode}
          disabled={busy}
          onChange={(event) =>
            void saveGeneral({
              displayMode: (event.currentTarget as HTMLSelectElement)
                .value as DisplayMode,
            })
          }
        >
          {DISPLAY_MODES.map((mode) => (
            <option value={mode.id}>{mode.label}</option>
          ))}
        </select>
      </section>

      <section aria-label={strings.options.autoSites}>
        <h2>{strings.options.autoSites}</h2>
        <ul class="options__site-list">
          {settings.autoSites.map((site) => (
            <li>
              <span>{site}</span>
              <button
                type="button"
                class="options__btn"
                disabled={busy}
                aria-label={`${strings.options.removeSite} ${site}`}
                onClick={() =>
                  void saveGeneral({
                    autoSites: settings.autoSites.filter((item) => item !== site),
                  })
                }
              >
                {strings.options.removeSite}
              </button>
            </li>
          ))}
        </ul>
        <label for="lp-add-site">{strings.options.addSiteLabel}</label>
        <div class="options__row">
          <input
            id="lp-add-site"
            type="text"
            placeholder={strings.options.sitePlaceholder}
            value={siteDraft}
            disabled={busy}
            onInput={(event) =>
              setSiteDraft((event.currentTarget as HTMLInputElement).value)
            }
          />
          <button
            type="button"
            class="options__btn"
            disabled={busy || !siteDraft.trim()}
            onClick={() => {
              const host = normalizeAutoSiteHostname(siteDraft);
              if (!host) {
                setError(strings.options.invalidSite);
                return;
              }
              if (settings.autoSites.includes(host)) return;
              void saveGeneral({ autoSites: [...settings.autoSites, host] });
              setSiteDraft('');
            }}
          >
            {strings.options.addSite}
          </button>
        </div>
      </section>

      <section aria-label={strings.options.cache}>
        <h2>{strings.options.cache}</h2>
        {usage ? (
          <p class="options__hint">
            {strings.options.cacheUsage(
              usage.count,
              (usage.bytes / (1024 * 1024)).toFixed(1),
              cachePercent,
            )}
          </p>
        ) : null}
        <label for="lp-cache-ttl">{strings.options.cacheTtl}</label>
        <input
          id="lp-cache-ttl"
          type="number"
          min="1"
          value={settings.cache.ttlDays}
          disabled={busy}
          onChange={(event) => {
            const ttlDays = parseCacheField(
              (event.currentTarget as HTMLInputElement).value,
            );
            if (ttlDays === undefined) {
              setError(strings.options.invalidCache);
              return;
            }
            void saveGeneral({ cache: { ttlDays } });
          }}
        />
        <label for="lp-cache-max">{strings.options.cacheMaxMb}</label>
        <input
          id="lp-cache-max"
          type="number"
          min="1"
          value={settings.cache.maxMB}
          disabled={busy}
          onChange={(event) => {
            const maxMB = parseCacheField(
              (event.currentTarget as HTMLInputElement).value,
            );
            if (maxMB === undefined) {
              setError(strings.options.invalidCache);
              return;
            }
            void saveGeneral({ cache: { maxMB } });
          }}
        />
        <label for="lp-delete-origin">{strings.options.deleteSiteCache}</label>
        <div class="options__row">
          <input
            id="lp-delete-origin"
            type="url"
            placeholder={strings.options.deleteSitePlaceholder}
            value={deleteOrigin}
            disabled={busy}
            onInput={(event) =>
              setDeleteOrigin((event.currentTarget as HTMLInputElement).value)
            }
          />
          <button
            type="button"
            class="options__btn"
            disabled={busy || !deleteOrigin.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const response = await deps.uiRequest({
                  type: 'deleteSiteCache',
                  origin: deleteOrigin.trim(),
                });
                if (!response.ok) throw new Error('failed');
                setDeleteOrigin('');
                await refreshCacheUsage();
                setMessage(strings.options.saved);
              } catch {
                setError(strings.options.requestFailed);
              } finally {
                setBusy(false);
              }
            }}
          >
            {strings.options.deleteSiteCache}
          </button>
        </div>
        <button
          type="button"
          class="options__btn"
          disabled={busy}
          onClick={async () => {
            if (!deps.confirm(strings.options.clearCacheConfirm)) return;
            setBusy(true);
            try {
              const response = await deps.uiRequest({ type: 'clearCache' });
              if (!response.ok) throw new Error('failed');
              setUsage({ count: 0, bytes: 0 });
              await refreshCacheUsage();
              setMessage(strings.options.saved);
            } catch {
              setError(strings.options.requestFailed);
            } finally {
              setBusy(false);
            }
          }}
        >
          {strings.options.clearCache}
        </button>
      </section>

      <section aria-label={strings.options.shortcuts}>
        <h2>{strings.options.shortcuts}</h2>
        <p class="options__hint">{strings.options.shortcutsHint}</p>
        <ul>
          {commands.length ? (
            commands.map((command) => (
              <li>
                {commandLabel(command.name)}: {command.shortcut || '—'}
              </li>
            ))
          ) : (
            <li>{strings.options.noCommands}</li>
          )}
        </ul>
        <a href={SHORTCUTS_HELP_URL}>{strings.options.shortcutsPage}</a>
      </section>
    </main>
  );
}

const appRoot = document.getElementById('app');
if (appRoot && !import.meta.env.VITEST) {
  render(
    <OptionsApp
      deps={{
        uiRequest,
        getSettings,
        updateSettings,
        onSettingsChanged,
        requestProviderPermission,
        getCommands: async () =>
          filterOptionsCommands(await browser.commands.getAll()),
        confirm: (message) => window.confirm(message),
      }}
    />,
    appRoot,
  );
}
