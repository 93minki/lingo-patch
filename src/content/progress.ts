import type { ProviderError } from '../providers/types';
import { progressErrorCopy, strings } from '../ui/strings';

export type ProgressState = {
  requested: number;
  completed: number;
  error?: ProviderError['kind'] | 'unconfigured';
};

const SHOW_DELAY_MS = 300;
const DONE_VISIBLE_MS = 1500;
const FADE_MS = 300;
const HOST_ID = 'lp-progress';

const PROGRESS_CSS = `
:host {
  all: initial;
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  pointer-events: none;
}
.pill {
  box-sizing: border-box;
  display: none;
  align-items: center;
  gap: 6px;
  max-width: min(92vw, 480px);
  padding: 8px 18px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.88);
  color: rgba(0, 0, 0, 0.86);
  font:
    500 14px/1.4 system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  pointer-events: none;
  opacity: 1;
  transition: opacity ${FADE_MS}ms ease;
  backdrop-filter: blur(8px);
}
.pill.visible {
  display: inline-flex;
}
.pill.fade-out {
  opacity: 0;
}
.open-options {
  pointer-events: auto;
  cursor: pointer;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media (prefers-color-scheme: dark) {
  .pill {
    border-color: rgba(255, 255, 255, 0.12);
    background: rgba(32, 32, 32, 0.88);
    color: rgba(255, 255, 255, 0.92);
  }
}
`.trim();

export function createProgress(
  doc: Document,
  onOpenOptions: () => void,
): { update(state: ProgressState): void; destroy(): void } {
  let host = doc.getElementById(HOST_ID) as HTMLElement | null;
  if (!host) {
    host = doc.createElement('lp-progress');
    host.id = HOST_ID;
    host.setAttribute('data-lp-ignore', '');
    doc.documentElement.appendChild(host);
  }
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!root.querySelector('style')) {
    root.innerHTML = `<style>${PROGRESS_CSS}</style>
<div class="pill" part="pill" role="status" aria-live="polite">
  <span class="message"></span>
  <button type="button" class="open-options" hidden>${strings.progress.openSettings}</button>
</div>`;
  }

  const pill = root.querySelector('.pill') as HTMLDivElement;
  const message = root.querySelector('.message') as HTMLSpanElement;
  const link = root.querySelector('.open-options') as HTMLButtonElement;
  link.addEventListener('click', (event) => {
    event.preventDefault();
    onOpenOptions();
  });

  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let visible = false;
  let latest: ProgressState = { requested: 0, completed: 0 };

  const sameState = (a: ProgressState, b: ProgressState) =>
    a.requested === b.requested &&
    a.completed === b.completed &&
    a.error === b.error;

  const clearTimers = () => {
    if (showTimer !== undefined) clearTimeout(showTimer);
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    if (fadeTimer !== undefined) clearTimeout(fadeTimer);
    showTimer = hideTimer = fadeTimer = undefined;
  };

  const hide = () => {
    pill.classList.remove('visible', 'fade-out');
    link.hidden = true;
    message.textContent = '';
    visible = false;
  };

  const showPill = () => {
    pill.classList.remove('fade-out');
    pill.classList.add('visible');
    visible = true;
  };

  const renderProgress = (state: ProgressState) => {
    link.hidden = true;
    message.textContent = strings.progress.translating(
      state.completed,
      state.requested,
    );
    showPill();
  };

  const renderDone = () => {
    link.hidden = true;
    message.textContent = strings.progress.done;
    showPill();
  };

  const renderError = (kind: NonNullable<ProgressState['error']>) => {
    const copy = progressErrorCopy(kind);
    message.textContent = copy.showSettingsLink
      ? `${copy.message} · `
      : copy.message;
    link.hidden = !copy.showSettingsLink;
    showPill();
  };

  const scheduleDoneHide = () => {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    if (fadeTimer !== undefined) clearTimeout(fadeTimer);
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      pill.classList.add('fade-out');
      fadeTimer = setTimeout(() => {
        fadeTimer = undefined;
        hide();
      }, FADE_MS);
    }, DONE_VISIBLE_MS);
  };

  const update = (state: ProgressState) => {
    if (sameState(state, latest)) return;
    latest = state;
    if (state.error) {
      clearTimers();
      renderError(state.error);
      return;
    }

    if (state.requested === 0) {
      clearTimers();
      hide();
      return;
    }

    if (state.completed < state.requested) {
      if (hideTimer !== undefined || fadeTimer !== undefined) {
        clearTimers();
        hide();
      }
      if (visible) {
        renderProgress(state);
        return;
      }
      if (showTimer === undefined) {
        showTimer = setTimeout(() => {
          showTimer = undefined;
          if (
            latest.error ||
            latest.requested === 0 ||
            latest.completed >= latest.requested
          )
            return;
          renderProgress(latest);
        }, SHOW_DELAY_MS);
      }
      return;
    }

    if (showTimer !== undefined) {
      clearTimeout(showTimer);
      showTimer = undefined;
      hide();
      return;
    }

    if (!visible) return;

    renderDone();
    scheduleDoneHide();
  };

  return {
    update,
    destroy() {
      clearTimers();
      hide();
      host?.remove();
    },
  };
}
