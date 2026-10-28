import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type {
  TabStatus,
  UiRequest,
  UiResponse,
} from '../../messaging/extension';
import { uiRequest } from '../../messaging/extension';
import type { DisplayMode } from '../../messaging/types';
import { requestProviderPermission } from '../../platform/permissions';
import {
  getSettings,
  onSettingsChanged,
  updateSettings,
  type Settings,
} from '../../storage/settings';
import { KEY_LINKS } from '../../ui/key-links';
import { SettingsSections } from '../../ui/SettingsSections';
import { strings } from '../../ui/strings';
import './popup.css';

export type PopupView = 'main' | 'settings';

export type PopupDeps = {
  queryActiveTab: () => Promise<{ id: number } | undefined>;
  uiRequest: (request: UiRequest) => Promise<UiResponse>;
  confirm: (message: string) => boolean;
  openOptionsPage: () => void | Promise<void>;
  getSettings: typeof getSettings;
  updateSettings: typeof updateSettings;
  onSettingsChanged: typeof onSettingsChanged;
  requestProviderPermission: typeof requestProviderPermission;
};

const POLL_MS = 500;
const modes: { id: DisplayMode; label: string }[] = [
  { id: 'bilingual', label: strings.popup.modeBilingual },
  { id: 'translation', label: strings.popup.modeTranslation },
  { id: 'original', label: strings.popup.modeOriginal },
];

export function retranslateCount(status: TabStatus): number {
  return status.total || status.translated + status.restored;
}

function unavailableStatus(hostname = ''): TabStatus {
  return {
    available: false,
    configured: false,
    enabled: false,
    hostname,
    origin: '',
    displayMode: 'bilingual',
    autoEnabled: false,
    total: 0,
    restored: 0,
    translated: 0,
    pending: 0,
  };
}

function PopupSettingsLink({
  busy,
  onOpen,
}: {
  busy: boolean;
  onOpen: () => void;
}) {
  return (
    <p class="popup__footer">
      <button
        type="button"
        class="popup__btn popup__btn--link"
        disabled={busy}
        onClick={onOpen}
      >
        {strings.popup.settings}
      </button>
    </p>
  );
}

function PopupSettingsView({
  deps,
  onBack,
}: {
  deps: PopupDeps;
  onBack: () => void;
}) {
  const [settings, setSettings] = useState<Settings | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    setLoadError(undefined);
    void deps
      .getSettings()
      .then((next) => {
        if (!alive) return;
        setSettings(next);
      })
      .catch(() => {
        if (!alive) return;
        setLoadError(strings.popup.requestFailed);
      });
    const stop = deps.onSettingsChanged((next) => {
      if (!alive) return;
      setSettings(next);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [deps]);

  const handleSaved = () => {
    onBack();
  };

  return (
    <main
      class="popup popup--settings popup--scroll"
      aria-label={strings.popup.settingsScreen}
      aria-busy={busy}
    >
      <div class="popup__settings-head">
        <button
          type="button"
          class="popup__btn popup__btn--back"
          disabled={busy}
          aria-label={strings.popup.settingsBack}
          onClick={onBack}
        >
          {strings.popup.settingsBack}
        </button>
      </div>
      {loadError ? <p class="popup__error">{loadError}</p> : null}
      {error ? <p class="popup__error">{error}</p> : null}
      {message ? <p class="popup__success">{message}</p> : null}
      {!settings && !loadError ? (
        <p class="popup__message">{strings.popup.loading}</p>
      ) : null}
      {settings && settings.provider === null ? (
        <section
          class="popup__free-hint"
          aria-label={strings.options.onboardingFreeTitle}
        >
          <p class="popup__message">
            {strings.popup.freeKeyHint}{' '}
            <a href={KEY_LINKS.gemini.signup} target="_blank" rel="noreferrer">
              Gemini
            </a>
          </p>
          <p class="popup__message popup__message--muted">
            {strings.popup.freeKeyAdvanced}
          </p>
        </section>
      ) : null}
      {settings ? (
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
          setError={setError}
          setMessage={setMessage}
          compact
          allowCustomEngine={false}
          onOpenAdvancedOptions={() => void deps.openOptionsPage()}
          onSaved={handleSaved}
          idPrefix="popup"
        />
      ) : null}
      <p class="popup__footer popup__footer--advanced">
        <button
          type="button"
          class="popup__btn popup__btn--link"
          disabled={busy}
          onClick={() => void deps.openOptionsPage()}
        >
          용어집 관리
        </button>
        <button
          type="button"
          class="popup__btn popup__btn--link"
          disabled={busy}
          onClick={() => void deps.openOptionsPage()}
        >
          {strings.popup.advancedSettingsLink}
        </button>
      </p>
    </main>
  );
}

export function PopupApp({ deps }: { deps: PopupDeps }) {
  const [view, setView] = useState<PopupView>('main');
  const [tabId, setTabId] = useState<number | null | undefined>(undefined);
  const [status, setStatus] = useState<TabStatus | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [bootstrapError, setBootstrapError] = useState<string | undefined>();
  const [retryToken, setRetryToken] = useState(0);

  const refresh = useCallback(async () => {
    if (typeof tabId !== 'number') return;
    try {
      const response = await deps.uiRequest({ type: 'getTabStatus', tabId });
      if (response.ok && response.status) {
        setStatus(response.status);
        setError(undefined);
        return;
      }
      setError(strings.popup.requestFailed);
    } catch {
      setError(strings.popup.requestFailed);
    }
  }, [deps, tabId]);

  useEffect(() => {
    let alive = true;
    setBootstrapError(undefined);
    setTabId(undefined);
    setStatus(undefined);
    void deps
      .queryActiveTab()
      .then((tab) => {
        if (!alive) return;
        if (tab?.id === undefined) {
          setTabId(null);
          setStatus(unavailableStatus());
          return;
        }
        setTabId(tab.id);
      })
      .catch(() => {
        if (!alive) return;
        setBootstrapError(strings.popup.requestFailed);
        setTabId(null);
      });
    return () => {
      alive = false;
    };
  }, [deps, retryToken]);

  useEffect(() => {
    if (typeof tabId !== 'number') return;
    let alive = true;
    const poll = async () => {
      try {
        const response = await deps.uiRequest({ type: 'getTabStatus', tabId });
        if (!alive) return;
        if (response.ok && response.status) {
          setStatus(response.status);
          setError(undefined);
        } else setError(strings.popup.requestFailed);
      } catch {
        if (!alive) return;
        setError(strings.popup.requestFailed);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [deps, tabId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await refresh();
    } catch {
      setError(strings.popup.requestFailed);
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => setView('settings');

  const leaveSettings = () => {
    setView('main');
    void refresh();
  };

  if (view === 'settings') {
    return <PopupSettingsView deps={deps} onBack={leaveSettings} />;
  }

  if (bootstrapError) {
    return (
      <main class="popup">
        <h1 class="popup__title">{strings.popup.title}</h1>
        <p class="popup__error">{bootstrapError}</p>
        <button
          type="button"
          class="popup__btn popup__btn--primary popup__btn--ghost"
          aria-label={strings.popup.retry}
          onClick={() => setRetryToken((value) => value + 1)}
        >
          {strings.popup.retry}
        </button>
        <PopupSettingsLink busy={false} onOpen={openSettings} />
      </main>
    );
  }

  if (tabId === undefined || !status) {
    return (
      <main class="popup" aria-busy="true">
        <h1 class="popup__title">{strings.popup.title}</h1>
        <p class="popup__message">
          {tabId === undefined ? strings.popup.loading : strings.popup.checking}
        </p>
        <PopupSettingsLink busy={false} onOpen={openSettings} />
      </main>
    );
  }

  if (!status.available) {
    return (
      <main class="popup">
        <h1 class="popup__title">{strings.popup.title}</h1>
        <p class="popup__host">{status.hostname || '—'}</p>
        <p class="popup__message">{strings.popup.unavailable}</p>
        <PopupSettingsLink busy={busy} onOpen={openSettings} />
      </main>
    );
  }

  if (!status.configured) {
    return (
      <main class="popup">
        <h1 class="popup__title">{strings.popup.title}</h1>
        <p class="popup__host">{status.hostname || '—'}</p>
        {error ? <p class="popup__error">{error}</p> : null}
        <button
          type="button"
          class="popup__btn popup__btn--primary popup__btn--ghost"
          disabled={busy}
          aria-label={strings.popup.configure}
          onClick={openSettings}
        >
          {strings.popup.configure}
        </button>
        <PopupSettingsLink busy={busy} onOpen={openSettings} />
      </main>
    );
  }

  const count = retranslateCount(status);

  return (
    <main class="popup" aria-busy={busy}>
      <h1 class="popup__title">{strings.popup.title}</h1>
      <p class="popup__host">{status.hostname}</p>
      {error ? <p class="popup__error">{error}</p> : null}

      <label class="popup__toggle">
        <input
          type="checkbox"
          checked={status.autoEnabled}
          disabled={busy}
          aria-label={strings.popup.autoSite}
          onChange={(event) => {
            const enabled = (event.currentTarget as HTMLInputElement).checked;
            void run(async () => {
              const response = await deps.uiRequest({
                type: 'setAutoSite',
                tabId: tabId as number,
                enabled,
              });
              if (!response.ok) throw new Error('failed');
            });
          }}
        />
        {strings.popup.autoSite}
      </label>

      <div class="popup__row">
        <button
          type="button"
          class="popup__btn popup__btn--primary"
          disabled={busy}
          aria-label={
            status.enabled
              ? strings.popup.translateOff
              : strings.popup.translateOn
          }
          onClick={() =>
            void run(async () => {
              const response = await deps.uiRequest({
                type: 'toggleTab',
                tabId: tabId as number,
              });
              if (!response.ok) throw new Error('failed');
            })
          }
        >
          {status.enabled
            ? strings.popup.translateOff
            : strings.popup.translateOn}
        </button>
      </div>

      <section class="popup__section" aria-label={strings.popup.displayMode}>
        <span class="popup__label">{strings.popup.displayMode}</span>
        <div class="popup__row">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              class={
                status.displayMode === mode.id
                  ? 'popup__btn popup__btn--active'
                  : 'popup__btn'
              }
              disabled={busy}
              aria-label={mode.label}
              aria-pressed={status.displayMode === mode.id}
              onClick={() =>
                void run(async () => {
                  const response = await deps.uiRequest({
                    type: 'setDisplayMode',
                    displayMode: mode.id,
                  });
                  if (!response.ok) throw new Error('failed');
                })
              }
            >
              {mode.label}
            </button>
          ))}
        </div>
      </section>

      <section class="popup__section">
        <button
          type="button"
          class="popup__btn popup__btn--ghost"
          disabled={busy || count === 0}
          aria-label={strings.popup.retranslate}
          onClick={() => {
            if (!deps.confirm(strings.popup.retranslateConfirm(count))) return;
            void run(async () => {
              const response = await deps.uiRequest({
                type: 'retranslatePage',
                tabId: tabId as number,
              });
              if (!response.ok) throw new Error('failed');
            });
          }}
        >
          {strings.popup.retranslate}
        </button>
      </section>

      <section
        class="popup__section popup__stats"
        aria-label={strings.popup.statsSection}
      >
        <div class="popup__stat">
          <span class="popup__stat-value">{status.total}</span>
          <span class="popup__stat-label">{strings.popup.statsTotal}</span>
        </div>
        <div class="popup__stat">
          <span class="popup__stat-value">{status.restored}</span>
          <span class="popup__stat-label">{strings.popup.statsRestored}</span>
        </div>
        <div class="popup__stat">
          <span class="popup__stat-value">{status.translated}</span>
          <span class="popup__stat-label">{strings.popup.statsTranslated}</span>
        </div>
        <div class="popup__stat">
          <span class="popup__stat-value">{status.pending}</span>
          <span class="popup__stat-label">{strings.popup.statsPending}</span>
        </div>
      </section>
      <PopupSettingsLink busy={busy} onOpen={openSettings} />
    </main>
  );
}

const appRoot = document.getElementById('app');
if (appRoot && !import.meta.env.VITEST) {
  render(
    <PopupApp
      deps={{
        queryActiveTab: async () => {
          const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          return tab?.id === undefined ? undefined : { id: tab.id };
        },
        uiRequest,
        confirm: (message) => window.confirm(message),
        openOptionsPage: () => browser.runtime.openOptionsPage(),
        getSettings,
        updateSettings,
        onSettingsChanged,
        requestProviderPermission,
      }}
    />,
    appRoot,
  );
}
