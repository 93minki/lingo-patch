import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { selectModelOptions } from '../providers/models';
import { isFreeModel, PRESETS, type PresetId } from '../providers/presets';
import type { ProviderConfig } from '../providers/types';
import type { UiRequest, UiResponse } from '../messaging/extension';
import type { DisplayMode } from '../messaging/types';
import { requestProviderAccess } from '../platform/host-access';
import {
  getSettings,
  updateSettings,
  type ProviderSettings,
  type Settings,
  type SettingsPatch,
} from '../storage/settings';
import {
  clearApiKey as clearApiKeyStorage,
  getApiKey as getApiKeyStorage,
  onSecretsChanged,
  setApiKey as setApiKeyStorage,
} from '../storage/secrets';
import { strings } from './strings';

export const LIST_MODELS_PROBE = '__list_models__';

const LIMIT_LINKS = {
  openai:
    'https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform',
  anthropic: 'https://platform.claude.com/docs/en/manage-claude/workspaces',
  gemini: 'https://ai.google.dev/gemini-api/docs/api-key?hl=en',
} as const;

export type EngineKind =
  'openai' | 'anthropic' | 'gemini' | 'preset' | 'custom';

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

export function secretKeyId(engine: EngineKind, presetId: PresetId): string {
  if (engine === 'preset') return presetId;
  if (engine === 'custom') return 'openai-compatible';
  return engine;
}

export function activeSecretId(settings: Settings): string | undefined {
  if (!settings.provider) return undefined;
  if (settings.preset) return settings.preset;
  return settings.provider.provider;
}

export function engineDisplayName(
  engine: EngineKind,
  presetId: PresetId,
): string {
  if (engine === 'preset') {
    if (presetId === 'deepseek') return strings.options.engineDeepseek;
    if (presetId === 'groq') return strings.options.engineGroq;
    return strings.options.engineOpenrouter;
  }
  if (engine === 'custom') return strings.options.engineCustom;
  if (engine === 'openai') return strings.options.engineOpenai;
  if (engine === 'anthropic') return strings.options.engineAnthropic;
  return strings.options.engineGemini;
}

export function providerFingerprint(settings: Settings): string {
  const provider = settings.provider;
  if (!provider) return 'none';
  return [
    settings.preset ?? '',
    provider.provider,
    provider.baseUrl ?? '',
    provider.model,
  ].join('|');
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
  'saved' | 'permission' | 'invalid-model' | 'invalid-url' | 'invalid-key';

export type SettingsSectionsDeps = {
  uiRequest: (request: UiRequest) => Promise<UiResponse>;
  updateSettings: typeof updateSettings;
  getSettings: typeof getSettings;
  hasProviderAccess: (baseUrls: string[]) => Promise<boolean>;
  requestProviderAccess: typeof requestProviderAccess;
  getApiKey?: typeof getApiKeyStorage;
  setApiKey?: typeof setApiKeyStorage;
  clearApiKey?: typeof clearApiKeyStorage;
  confirm?: (message: string) => boolean;
};

function resolveSecretsDeps(
  deps: Pick<SettingsSectionsDeps, 'getApiKey' | 'setApiKey' | 'clearApiKey'>,
) {
  return {
    getApiKey: deps.getApiKey ?? getApiKeyStorage,
    setApiKey: deps.setApiKey ?? setApiKeyStorage,
    clearApiKey: deps.clearApiKey ?? clearApiKeyStorage,
  };
}

async function keyForValidation(
  getApiKey: typeof getApiKeyStorage,
  id: string,
  draft: string,
  engine: EngineKind,
): Promise<string | undefined> {
  const trimmed = draft.trim();
  if (trimmed) return trimmed;
  if (engine === 'custom') {
    const stored = await getApiKey(id);
    if (stored !== undefined) return stored;
    return draft;
  }
  const stored = await getApiKey(id);
  if (stored === undefined || stored === '') return undefined;
  return stored;
}

export function buildProviderSettings(input: {
  engine: EngineKind;
  presetId?: PresetId;
  model: string;
  baseUrl: string;
}): ProviderSettings {
  if (input.engine === 'preset') {
    const preset = PRESETS.find((item) => item.id === input.presetId)!;
    return {
      provider: 'openai-compatible',
      model: input.model || LIST_MODELS_PROBE,
      baseUrl: preset.baseUrl,
    };
  }
  if (input.engine === 'custom') {
    return {
      provider: 'openai-compatible',
      model: input.model || LIST_MODELS_PROBE,
      baseUrl: input.baseUrl.trim(),
    };
  }
  return {
    provider: input.engine,
    model: input.model || LIST_MODELS_PROBE,
  };
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

export async function persistEngineSettings(
  deps: Pick<
    SettingsSectionsDeps,
    'hasProviderAccess' | 'updateSettings' | 'getApiKey' | 'setApiKey'
  >,
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
  const secrets = resolveSecretsDeps(deps);
  const id = secretKeyId(input.engine, input.presetId);
  const permissionUrl = permissionBaseUrl(
    input.engine,
    input.presetId,
    input.baseUrl,
  );
  if (permissionUrl !== undefined) {
    if (!isHttpProviderBaseUrl(permissionUrl)) return 'invalid-url';
    if (!(await deps.hasProviderAccess([permissionUrl]))) return 'permission';
  }
  const apiKey = await keyForValidation(
    secrets.getApiKey,
    id,
    input.apiKey,
    input.engine,
  );
  if (apiKey === undefined) return 'invalid-key';
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
  await secrets.setApiKey(id, apiKey);
  const provider = buildProviderSettings({ ...input, model });
  if (input.engine === 'preset') {
    await deps.updateSettings({ provider, preset: input.presetId });
  } else {
    await deps.updateSettings({ provider, preset: undefined });
  }
  return 'saved';
}

export async function validateProviderKey(
  deps: Pick<SettingsSectionsDeps, 'uiRequest' | 'hasProviderAccess'>,
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
    if (!(await deps.hasProviderAccess([permissionUrl]))) {
      return { ok: false, reason: 'permission' };
    }
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

export type SettingsSectionsProps = {
  settings: Settings;
  deps: SettingsSectionsDeps;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  error?: string;
  setError: (error?: string) => void;
  message?: string;
  setMessage: (message?: string) => void;
  compact?: boolean;
  allowCustomEngine?: boolean;
  onOpenAdvancedOptions?: () => void;
  onSaved?: () => void;
  idPrefix?: string;
};

export function SettingsSections({
  settings,
  deps,
  busy,
  setBusy,
  setError,
  setMessage,
  compact = false,
  allowCustomEngine = true,
  onOpenAdvancedOptions,
  onSaved,
  idPrefix = 'lp',
}: SettingsSectionsProps) {
  const [engine, setEngine] = useState<EngineKind>('gemini');
  const [presetId, setPresetId] = useState<PresetId>('groq');
  const [apiKey, setApiKey] = useState('');
  const keyDraft = useRef('');
  const keyDirty = useRef(false);
  const keyLoadVersion = useRef(0);
  const [storedKeyPresent, setStoredKeyPresent] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [apiAccessGranted, setApiAccessGranted] = useState(true);
  const syncedFingerprint = useRef('');
  const secrets = useMemo(() => resolveSecretsDeps(deps), [deps]);
  const confirmDialog =
    deps.confirm ?? ((message: string) => window.confirm(message));

  const refreshApiAccess = async (
    nextEngine = engine,
    nextPreset = presetId,
    nextBaseUrl = baseUrl,
  ) => {
    const permissionUrl = permissionBaseUrl(
      nextEngine,
      nextPreset,
      nextBaseUrl,
    );
    if (permissionUrl === undefined) {
      setApiAccessGranted(true);
      return;
    }
    setApiAccessGranted(await deps.hasProviderAccess([permissionUrl]));
  };

  const rowClass = compact ? 'lp-settings-row' : 'options__row';
  const btnClass = compact ? 'lp-settings-btn' : 'options__btn';
  const btnPrimaryClass = compact
    ? 'lp-settings-btn lp-settings-btn--primary'
    : 'options__btn options__btn--primary';
  const noticeClass = compact ? 'lp-settings-notice' : 'options__notice';

  const engineId = `${idPrefix}-engine`;
  const apiKeyId = `${idPrefix}-api-key`;
  const baseUrlId = `${idPrefix}-base-url`;
  const modelId = `${idPrefix}-model`;
  const targetLangId = `${idPrefix}-target-lang`;
  const displayModeId = `${idPrefix}-display-mode`;

  const resetEngineDraft = () => {
    keyDirty.current = false;
    setModel('');
    setBaseUrl('');
    setModels([]);
    setMessage(undefined);
    setError(undefined);
  };

  const loadSecretDraft = async (
    nextEngine: EngineKind,
    nextPreset: PresetId,
  ) => {
    const id = secretKeyId(nextEngine, nextPreset);
    const version = ++keyLoadVersion.current;
    const stored = await secrets.getApiKey(id);
    if (version !== keyLoadVersion.current) return;
    if (!keyDirty.current) {
      keyDraft.current = stored ?? '';
      setApiKey(keyDraft.current);
    }
    setStoredKeyPresent(stored !== undefined);
  };

  const applySettingsToForm = async (next: Settings) => {
    const inferred = inferEngine(next);
    setEngine(inferred.engine);
    if (inferred.presetId) setPresetId(inferred.presetId);
    setModel(next.provider?.model ?? '');
    setBaseUrl(next.provider?.baseUrl ?? '');
    setModels([]);
    await loadSecretDraft(inferred.engine, inferred.presetId ?? presetId);
    syncedFingerprint.current = providerFingerprint(next);
  };

  useEffect(() => {
    if (providerFingerprint(settings) === syncedFingerprint.current) return;
    void applySettingsToForm(settings);
  }, [settings]);

  useEffect(() => {
    const stop = onSecretsChanged(() => {
      void loadSecretDraft(engine, presetId);
    });
    return stop;
  }, [engine, presetId]);

  useEffect(() => {
    void refreshApiAccess();
  }, [engine, presetId, baseUrl]);

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
      models.length > 0 &&
      engine === 'preset' &&
      presetId === 'openrouter' &&
      model &&
      !modelChoices.includes(model)
    ) {
      setModel('');
    }
  }, [engine, presetId, freeOnly, model, modelChoices, models.length]);

  const grantApiAccess = async () => {
    const permissionUrl = permissionBaseUrl(engine, presetId, baseUrl);
    if (permissionUrl === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const granted = await deps.requestProviderAccess(permissionUrl);
      setApiAccessGranted(granted);
      if (!granted) setError(strings.options.permissionDenied);
    } catch {
      setError(strings.options.requestFailed);
    } finally {
      setBusy(false);
    }
  };

  const validateKey = async () => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const id = secretKeyId(engine, presetId);
      const resolvedKey = await keyForValidation(
        secrets.getApiKey,
        id,
        keyDraft.current,
        engine,
      );
      if (resolvedKey === undefined) {
        setError(strings.options.invalidKey);
        return;
      }
      const result = await validateProviderKey(deps, {
        engine,
        presetId,
        apiKey: resolvedKey,
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
      const picked = pickDefaultModel(
        engine,
        presetId,
        result.models,
        freeOnly,
      );
      if (picked) setModel(picked);
      setMessage(strings.options.validateOk);
    } catch {
      setError(strings.options.requestFailed);
    } finally {
      setBusy(false);
    }
  };

  const deleteStoredKey = async () => {
    const id = secretKeyId(engine, presetId);
    if (!storedKeyPresent) return;
    const label = engineDisplayName(engine, presetId);
    if (!confirmDialog(strings.options.deleteKeyConfirm(label))) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await secrets.clearApiKey(id);
      keyDirty.current = false;
      keyDraft.current = '';
      keyLoadVersion.current++;
      setApiKey('');
      setStoredKeyPresent(false);
      setModels([]);
      setMessage(strings.options.keyDeleted);
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
      const result: PersistResult = await persistEngineSettings(deps, {
        engine,
        presetId,
        apiKey: keyDraft.current,
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
      keyDirty.current = false;
      setMessage(strings.options.saved);
      const next = await deps.getSettings();
      syncedFingerprint.current = providerFingerprint(next);
      const id = secretKeyId(engine, presetId);
      setStoredKeyPresent((await secrets.getApiKey(id)) !== undefined);
      onSaved?.();
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

  const customGuideOnly = !allowCustomEngine && engine === 'custom';

  return (
    <>
      <section
        id={compact ? undefined : 'engine'}
        class={compact ? 'lp-settings-section' : undefined}
        aria-label={strings.options.engine}
      >
        <h2>{strings.options.engine}</h2>
        <label for={engineId}>{strings.options.engine}</label>
        <select
          id={engineId}
          value={engine === 'preset' ? `preset:${presetId}` : engine}
          disabled={busy}
          onChange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            resetEngineDraft();
            if (value.startsWith('preset:')) {
              const nextPreset = value.slice(7) as PresetId;
              setEngine('preset');
              setPresetId(nextPreset);
              void loadSecretDraft('preset', nextPreset);
              return;
            }
            const nextEngine = value as EngineKind;
            setEngine(nextEngine);
            void loadSecretDraft(nextEngine, presetId);
          }}
        >
          <option value="gemini">{strings.options.engineGemini}</option>
          <option value="openai">{strings.options.engineOpenai}</option>
          <option value="anthropic">{strings.options.engineAnthropic}</option>
          <option value="preset:deepseek">
            {strings.options.engineDeepseek}
          </option>
          <option value="preset:groq">{strings.options.engineGroq}</option>
          <option value="preset:openrouter">
            {strings.options.engineOpenrouter}
          </option>
          <option value="custom">{strings.options.engineCustom}</option>
        </select>

        {customGuideOnly ? (
          <p class={noticeClass}>
            {strings.popup.customEngineGuide}{' '}
            {onOpenAdvancedOptions ? (
              <button
                type="button"
                class={compact ? 'lp-settings-link' : 'options__btn'}
                disabled={busy}
                onClick={onOpenAdvancedOptions}
              >
                {strings.popup.openAdvancedOptions}
              </button>
            ) : null}
          </p>
        ) : (
          <>
            <label for={apiKeyId}>{strings.options.apiKey}</label>
            <div class={rowClass}>
              <div class="lp-settings-key-input">
                <input
                  id={apiKeyId}
                  {...(showKey
                    ? { type: 'text' as const }
                    : { type: 'password' as const })}
                  value={apiKey}
                  autoComplete="off"
                  disabled={busy}
                  onInput={(event) => {
                    keyDirty.current = true;
                    keyLoadVersion.current++;
                    keyDraft.current = (
                      event.currentTarget as HTMLInputElement
                    ).value;
                    setApiKey(keyDraft.current);
                  }}
                />
                <button
                  type="button"
                  class="lp-settings-key-toggle"
                  disabled={busy}
                  aria-label={
                    showKey ? strings.options.hideKey : strings.options.showKey
                  }
                  aria-pressed={showKey}
                  onClick={() => setShowKey((value) => !value)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {!showKey ? <path d="M3 3l18 18" /> : null}
                  </svg>
                </button>
              </div>
              <button
                type="button"
                class={btnClass}
                disabled={busy}
                onClick={() => void validateKey()}
              >
                {busy
                  ? strings.options.validating
                  : strings.options.validateKey}
              </button>
              {storedKeyPresent ? (
                <button
                  type="button"
                  class={btnClass}
                  disabled={busy}
                  onClick={() => void deleteStoredKey()}
                >
                  {strings.options.deleteKey}
                </button>
              ) : null}
            </div>

            {engine === 'custom' ? (
              <>
                <label for={baseUrlId}>{strings.options.baseUrl}</label>
                <input
                  id={baseUrlId}
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
              <label class={rowClass}>
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

            {!apiAccessGranted ? (
              <div class={rowClass}>
                <button
                  type="button"
                  class={btnPrimaryClass}
                  disabled={busy}
                  onClick={() => void grantApiAccess()}
                >
                  {strings.options.allowApiAccess}
                </button>
              </div>
            ) : null}

            <label for={modelId}>{strings.options.model}</label>
            <div class={`${rowClass} lp-settings-model-row`}>
              {engine === 'custom' ? (
                <input
                  id={modelId}
                  type="text"
                  value={model}
                  disabled={busy}
                  onInput={(event) =>
                    setModel((event.currentTarget as HTMLInputElement).value)
                  }
                />
              ) : selectChoices.length ? (
                <select
                  id={modelId}
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
                <select id={modelId} disabled>
                  <option value="">
                    {strings.options.validateModelsFirst}
                  </option>
                </select>
              )}
              <button
                type="button"
                class={btnPrimaryClass}
                disabled={busy}
                onClick={() => void saveEngine()}
              >
                {strings.options.save}
              </button>
            </div>
            {engine !== 'custom' && !selectChoices.length ? (
              <p class={noticeClass}>{strings.options.validateModelsFirst}</p>
            ) : null}
            <p class={noticeClass}>{strings.options.privacy}</p>
            {compact ? (
              <p class={noticeClass}>
                {strings.options.limitsHintPopup}{' '}
                {onOpenAdvancedOptions ? (
                  <button
                    type="button"
                    class={compact ? 'lp-settings-link' : 'options__btn'}
                    disabled={busy}
                    onClick={onOpenAdvancedOptions}
                  >
                    {strings.popup.openAdvancedOptions}
                  </button>
                ) : null}
              </p>
            ) : (
              <div class="options__limits">
                <p class={noticeClass}>{strings.options.limitsIntro}</p>
                <ul class="options__limits-list">
                  <li>
                    <a
                      href={LIMIT_LINKS.openai}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {strings.options.limitsOpenAi}
                    </a>
                  </li>
                  <li>
                    <a
                      href={LIMIT_LINKS.anthropic}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {strings.options.limitsAnthropic}
                    </a>
                  </li>
                  <li>
                    <a
                      href={LIMIT_LINKS.gemini}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {strings.options.limitsGemini}
                    </a>
                  </li>
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section
        class={compact ? 'lp-settings-section' : undefined}
        aria-label={strings.options.translation}
      >
        <h2>{strings.options.translation}</h2>
        <label for={targetLangId}>{strings.options.targetLang}</label>
        <select
          id={targetLangId}
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
        <label for={displayModeId}>{strings.options.defaultDisplayMode}</label>
        <select
          id={displayModeId}
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
    </>
  );
}
