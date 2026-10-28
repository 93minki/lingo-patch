import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { uiRequest, type UiRequest, type UiResponse } from '../../messaging/extension';
import { requestProviderPermission } from '../../platform/permissions';
import {
  getSettings,
  onSettingsChanged,
  updateSettings,
  type Settings,
  type SettingsPatch,
} from '../../storage/settings';
import { KEY_LINKS, SHORTCUTS_HELP_URL } from '../../ui/key-links';
import { SettingsSections } from '../../ui/SettingsSections';
import { commandLabel, strings } from '../../ui/strings';
import './options.css';

export {
  LIST_MODELS_PROBE,
  buildProviderConfig,
  filterOpenRouterModels,
  formatModelLabel,
  inferEngine,
  isEngineModelAllowed,
  isHttpProviderBaseUrl,
  listModelChoices,
  modelSelectChoices,
  persistEngineSettings,
  pickDefaultModel,
  providerFingerprint,
  validateProviderKey,
  type EngineKind,
  type PersistResult,
} from '../../ui/SettingsSections';

export function normalizeAutoSiteHostname(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.includes('/') || trimmed.includes(':')) return undefined;
  if (trimmed.includes('://')) return undefined;
  return trimmed;
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

export type OptionsDeps = {
  uiRequest: (request: UiRequest) => Promise<UiResponse>;
  getSettings: typeof getSettings;
  updateSettings: typeof updateSettings;
  onSettingsChanged: typeof onSettingsChanged;
  requestProviderPermission: typeof requestProviderPermission;
  getCommands: () => Promise<{ name?: string; shortcut?: string }[]>;
  confirm: (message: string) => boolean;
};

export function OptionsApp({ deps }: { deps: OptionsDeps }) {
  const [settings, setSettings] = useState<Settings | undefined>();
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

      <SettingsSections
        settings={settings}
        deps={{
          uiRequest: deps.uiRequest,
          updateSettings: deps.updateSettings,
          getSettings: deps.getSettings,
          requestProviderPermission: deps.requestProviderPermission,
        }}
        busy={busy}
        setBusy={setBusy}
        error={error}
        setError={setError}
        message={message}
        setMessage={setMessage}
      />

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
