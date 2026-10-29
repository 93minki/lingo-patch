import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import {
  uiRequest,
  type UiRequest,
  type UiResponse,
} from '../../messaging/extension';
import {
  hasProviderAccess,
  requestProviderAccess,
} from '../../platform/host-access';
import {
  getSettings,
  onSettingsChanged,
  updateSettings,
  type Settings,
  type SettingsPatch,
} from '../../storage/settings';
import {
  clearAllApiKeys,
  clearApiKey,
  getApiKey,
  onSecretsChanged,
  setApiKey,
} from '../../storage/secrets';
import { KEY_LINKS, SHORTCUTS_HELP_URL } from '../../ui/key-links';
import { activeSecretId, SettingsSections } from '../../ui/SettingsSections';
import { GlossaryEditor } from '../../ui/GlossaryEditor';
import { CacheTransfer } from '../../ui/CacheTransfer';
import {
  emptyGlossary,
  getGlossary,
  setGlossary,
} from '../../storage/glossary';
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
  if (!trimmed || trimmed.includes('/') || trimmed.includes(':'))
    return undefined;
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

export function showsOnboarding(
  provider: Settings['provider'],
  key: string | undefined,
): boolean {
  return provider === null || !key;
}

export const OPTIONS_SECTION_IDS = [
  'engine',
  'glossary',
  'sites',
  'cache',
  'shortcuts',
] as const;

export type OptionsSectionId = (typeof OPTIONS_SECTION_IDS)[number];

export function parseOptionsSectionHash(
  hash: string,
): OptionsSectionId | undefined {
  const id = hash.startsWith('#') ? hash.slice(1) : hash;
  return OPTIONS_SECTION_IDS.includes(id as OptionsSectionId)
    ? (id as OptionsSectionId)
    : undefined;
}

export function scrollToOptionsSection(
  hash: string,
  root: ParentNode = document,
): boolean {
  const id = parseOptionsSectionHash(hash);
  if (!id) return false;
  const target = root.querySelector(`#${CSS.escape(id)}`);
  if (!(target instanceof HTMLElement)) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

const OPTIONS_TOC: { id: OptionsSectionId; label: string }[] = [
  { id: 'engine', label: strings.options.engine },
  { id: 'glossary', label: '용어집' },
  { id: 'sites', label: strings.options.autoSites },
  { id: 'cache', label: strings.options.cache },
  { id: 'shortcuts', label: strings.options.shortcuts },
];

export type OptionsDeps = {
  uiRequest: (request: UiRequest) => Promise<UiResponse>;
  getSettings: typeof getSettings;
  updateSettings: typeof updateSettings;
  onSettingsChanged: typeof onSettingsChanged;
  hasProviderAccess: typeof hasProviderAccess;
  requestProviderAccess: typeof requestProviderAccess;
  getCommands: () => Promise<{ name?: string; shortcut?: string }[]>;
  confirm: (message: string) => boolean;
};

export function OptionsApp({ deps }: { deps: OptionsDeps }) {
  const [settings, setSettings] = useState<Settings | undefined>();
  const [glossary, setGlossaryDraft] = useState(emptyGlossary);
  useEffect(() => {
    void getGlossary()
      .then(setGlossaryDraft)
      .catch(() => {});
  }, []);
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
  const [contentReady, setContentReady] = useState(false);
  // null = 아직 읽는 중 (안내가 잠깐 깜빡이지 않게)
  const [storedKey, setStoredKey] = useState<string | undefined | null>(null);

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

  useEffect(() => {
    const id = settings && activeSecretId(settings);
    let alive = true;
    let version = 0;
    setStoredKey(id ? null : undefined);
    const refresh = () => {
      const current = ++version;
      if (!id) return;
      void getApiKey(id)
        .then((key) => {
          if (alive && current === version) setStoredKey(key);
        })
        .catch(() => {
          if (alive && current === version) setStoredKey(undefined);
        });
    };
    refresh();
    const stop = onSecretsChanged((ids) => {
      if (id && ids.includes(id)) refresh();
    });
    return () => {
      alive = false;
      stop();
    };
  }, [settings?.provider?.provider, settings?.preset]);

  useEffect(() => {
    if (!settings) {
      setContentReady(false);
      return;
    }
    setContentReady(true);
  }, [settings]);

  useEffect(() => {
    if (!contentReady) return;
    const scrollToHash = () => {
      if (!window.location.hash) return;
      requestAnimationFrame(() => {
        scrollToOptionsSection(window.location.hash);
      });
    };
    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
  }, [contentReady]);

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

      <nav class="options__toc" aria-label="설정 목차">
        <ul>
          {OPTIONS_TOC.map((item) => (
            <li>
              <a href={`#${item.id}`}>{item.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      {storedKey !== null && showsOnboarding(settings.provider, storedKey) ? (
        <section
          class="options__onboarding"
          aria-label={strings.options.onboardingFreeTitle}
        >
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
            <a
              href={KEY_LINKS.openrouter.signup}
              target="_blank"
              rel="noreferrer"
            >
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
            <a
              href={KEY_LINKS.anthropic.signup}
              target="_blank"
              rel="noreferrer"
            >
              Anthropic
            </a>
            {' · '}
            <a
              href={KEY_LINKS.deepseek.signup}
              target="_blank"
              rel="noreferrer"
            >
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
          hasProviderAccess: deps.hasProviderAccess,
          requestProviderAccess: deps.requestProviderAccess,
          getApiKey,
          setApiKey,
          clearApiKey,
          confirm: deps.confirm,
        }}
        busy={busy}
        setBusy={setBusy}
        error={error}
        setError={setError}
        message={message}
        setMessage={setMessage}
      />

      <section id="sites" aria-label={strings.options.autoSites}>
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
                    autoSites: settings.autoSites.filter(
                      (item) => item !== site,
                    ),
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

      <section id="cache" aria-label={strings.options.cache}>
        <h2>{strings.options.cache}</h2>
        <CacheTransfer
          uiRequest={deps.uiRequest}
          confirm={deps.confirm}
          onComplete={() => void refreshCacheUsage()}
        />
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

      <section aria-label={strings.options.advanced}>
        <h2>{strings.options.advanced}</h2>
        <label class="options__row" for="lp-skip-fixed-bars">
          <input
            id="lp-skip-fixed-bars"
            type="checkbox"
            checked={settings.skipFixedBars}
            disabled={busy}
            onChange={(event) =>
              void saveGeneral({
                skipFixedBars: (event.currentTarget as HTMLInputElement)
                  .checked,
              })
            }
          />
          {strings.options.skipFixedBars}
        </label>
        <p class="options__notice">{strings.options.skipFixedBarsHint}</p>
        <button
          type="button"
          class="options__btn"
          disabled={busy}
          onClick={() => {
            if (!deps.confirm(strings.options.clearAllKeysConfirm)) return;
            setBusy(true);
            setError(undefined);
            void clearAllApiKeys()
              .then(() => deps.getSettings())
              .then((next) => {
                setSettings(next);
                setMessage(strings.options.keyDeleted);
              })
              .catch(() => setError(strings.options.requestFailed))
              .finally(() => setBusy(false));
          }}
        >
          {strings.options.clearAllKeys}
        </button>
        <label class="options__row">
          <input
            type="checkbox"
            checked={settings.selectionTranslation !== false}
            onChange={(event) =>
              void saveGeneral({
                selectionTranslation: (event.currentTarget as HTMLInputElement)
                  .checked,
              })
            }
          />
          선택 번역 사용
        </label>
      </section>

      <section aria-label="용어집" id="glossary">
        <h2>용어집</h2>
        <GlossaryEditor value={glossary} onChange={setGlossaryDraft} />
        <button
          type="button"
          class="options__btn"
          onClick={() =>
            void setGlossary(glossary)
              .then(() => setMessage(strings.options.saved))
              .catch(() => setError(strings.options.requestFailed))
          }
        >
          용어집 저장
        </button>
      </section>

      <section id="shortcuts" aria-label={strings.options.shortcuts}>
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
        hasProviderAccess,
        requestProviderAccess,
        getCommands: async () =>
          filterOptionsCommands(await browser.commands.getAll()),
        confirm: (message) => window.confirm(message),
      }}
    />,
    appRoot,
  );
}
