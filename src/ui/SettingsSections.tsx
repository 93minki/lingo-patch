import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { selectModelOptions } from '../providers/models';
import { isFreeModel, PRESETS, type PresetId } from '../providers/presets';
import type { ProviderConfig } from '../providers/types';
import type { UiRequest, UiResponse } from '../messaging/extension';
import type { DisplayMode } from '../messaging/types';
import type { requestProviderPermission } from '../platform/permissions';
import {
  getSettings,
  updateSettings,
  type Settings,
  type SettingsPatch,
} from '../storage/settings';
import { strings } from './strings';

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

export type SettingsSectionsDeps = {
  uiRequest: (request: UiRequest) => Promise<UiResponse>;
  updateSettings: typeof updateSettings;
  getSettings: typeof getSettings;
  requestProviderPermission: typeof requestProviderPermission;
};

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
  deps: Pick<SettingsSectionsDeps, 'requestProviderPermission' | 'updateSettings'>,
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
  deps: Pick<SettingsSectionsDeps, 'uiRequest' | 'requestProviderPermission'>,
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
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const syncedFingerprint = useRef('');

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

  useEffect(() => {
    if (providerFingerprint(settings) !== syncedFingerprint.current) {
      syncEngineForm(settings);
    }
  }, [settings]);

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
      const result: PersistResult = await persistEngineSettings(deps, {
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
              {showKey ? (
                <input
                  id={apiKeyId}
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
                  id={apiKeyId}
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
                class={btnClass}
                disabled={busy}
                aria-label={
                  showKey ? strings.options.hideKey : strings.options.showKey
                }
                onClick={() => setShowKey((value) => !value)}
              >
                {showKey ? strings.options.hideKey : strings.options.showKey}
              </button>
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

            <label for={modelId}>{strings.options.model}</label>
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
              <>
                <select id={modelId} disabled>
                  <option value="">{strings.options.validateModelsFirst}</option>
                </select>
                <p class={noticeClass}>{strings.options.validateModelsFirst}</p>
              </>
            )}

            <div class={rowClass}>
              <button
                type="button"
                class={btnClass}
                disabled={busy}
                onClick={() => void validateKey()}
              >
                {busy ? strings.options.validating : strings.options.validateKey}
              </button>
              <button
                type="button"
                class={btnPrimaryClass}
                disabled={busy}
                onClick={() => void saveEngine()}
              >
                {strings.options.save}
              </button>
            </div>
            <p class={noticeClass}>{strings.options.privacy}</p>
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
