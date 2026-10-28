const HOST_ID = 'lp-selection-overlay';
const HOST_TAG = 'lp-selection-overlay';
const VIEWPORT_MARGIN = 8;
const BUTTON_OFFSET = 6;

const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
}

.btn,
.popover {
  position: fixed;
  pointer-events: auto;
  box-sizing: border-box;
  font:
    500 13px/1.45 system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}

.btn {
  display: none;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #ffffff;
  color: #1a1a1a;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}

.btn.visible {
  display: block;
}

.btn:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.popover {
  display: none;
  max-width: min(92vw, 420px);
  max-height: min(60vh, 320px);
  overflow: auto;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #ffffff;
  color: #1a1a1a;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.16);
  white-space: pre-wrap;
  word-break: break-word;
}

.popover.visible {
  display: block;
}

@media (prefers-color-scheme: dark) {
  .btn {
    border-color: rgba(255, 255, 255, 0.14);
    background: #242424;
    color: #f2f2f2;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
  }

  .btn:focus-visible {
    outline-color: #93c5fd;
  }

  .popover {
    border-color: rgba(255, 255, 255, 0.12);
    background: #242424;
    color: #f2f2f2;
    box-shadow: 0 4px 28px rgba(0, 0, 0, 0.55);
  }
}
`.trim();

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function placeNearRect(
  el: HTMLElement,
  rect: DOMRect,
  width: number,
  height: number,
): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.right + BUTTON_OFFSET;
  let top = rect.bottom + BUTTON_OFFSET;

  if (left + width + VIEWPORT_MARGIN > vw) {
    left = rect.left - width - BUTTON_OFFSET;
  }
  if (top + height + VIEWPORT_MARGIN > vh) {
    top = rect.top - height - BUTTON_OFFSET;
  }

  left = clamp(
    left,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, vw - width - VIEWPORT_MARGIN),
  );
  top = clamp(
    top,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN),
  );

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function createSelectionOverlay(
  doc: Document,
  onTranslate: (text: string) => void,
): {
  showButton(text: string, rect: DOMRect): void;
  showResult(text: string): void;
  hide(): void;
  destroy(): void;
} {
  let host = doc.getElementById(HOST_ID) as HTMLElement | null;
  if (!host) {
    host = doc.createElement(HOST_TAG);
    host.id = HOST_ID;
    host.setAttribute('data-lp-ignore', '');
    doc.documentElement.appendChild(host);
  }

  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!root.querySelector('style')) {
    const style = doc.createElement('style');
    style.textContent = OVERLAY_CSS;
    root.appendChild(style);

    const buttonEl = doc.createElement('button');
    buttonEl.type = 'button';
    buttonEl.className = 'btn';
    buttonEl.setAttribute('aria-label', '선택한 텍스트 번역');
    buttonEl.textContent = '번역';
    root.appendChild(buttonEl);

    const popoverEl = doc.createElement('div');
    popoverEl.className = 'popover';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-label', '선택 번역 결과');
    popoverEl.tabIndex = -1;
    root.appendChild(popoverEl);
  }

  const button = root.querySelector('.btn') as HTMLButtonElement;
  const popover = root.querySelector('.popover') as HTMLDivElement;

  let selectionText = '';
  let anchorRect: DOMRect | undefined;
  let destroyed = false;

  const isInsideHost = (event: Event): boolean => {
    const path = event.composedPath();
    return path.includes(host!);
  };

  const hideButton = () => {
    button.classList.remove('visible');
    button.style.left = '';
    button.style.top = '';
  };

  const hidePopover = () => {
    popover.classList.remove('visible');
    popover.textContent = '';
    popover.style.left = '';
    popover.style.top = '';
  };

  const hideAll = () => {
    hideButton();
    hidePopover();
    selectionText = '';
    anchorRect = undefined;
  };

  const layoutButton = () => {
    if (!anchorRect) return;
    button.classList.add('visible');
    const width = button.offsetWidth || 56;
    const height = button.offsetHeight || 32;
    placeNearRect(button, anchorRect, width, height);
  };

  const layoutPopover = () => {
    const rect = anchorRect;
    if (!rect) {
      popover.style.left = `${VIEWPORT_MARGIN}px`;
      popover.style.top = `${VIEWPORT_MARGIN}px`;
      return;
    }
    popover.classList.add('visible');
    const width = popover.offsetWidth || 280;
    const height = popover.offsetHeight || 120;
    placeNearRect(popover, rect, width, height);
  };

  const onButtonClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const text = selectionText;
    if (!text.trim()) return;
    hideButton();
    onTranslate(text);
  };

  const onDocPointerDown = (event: MouseEvent) => {
    if (destroyed) return;
    if (isInsideHost(event)) return;
    if (
      !button.classList.contains('visible') &&
      !popover.classList.contains('visible')
    ) {
      return;
    }
    hideAll();
  };

  const onDocKeyDown = (event: KeyboardEvent) => {
    if (destroyed) return;
    if (event.key !== 'Escape') return;
    if (
      !button.classList.contains('visible') &&
      !popover.classList.contains('visible')
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    hideAll();
  };

  button.addEventListener('click', onButtonClick);
  doc.addEventListener('mousedown', onDocPointerDown, true);
  doc.addEventListener('keydown', onDocKeyDown, true);

  return {
    showButton(text: string, rect: DOMRect) {
      if (destroyed) return;
      hidePopover();
      selectionText = text;
      anchorRect = rect;
      layoutButton();
      requestAnimationFrame(() => {
        if (destroyed || selectionText !== text) return;
        layoutButton();
      });
    },

    showResult(text: string) {
      if (destroyed) return;
      hideButton();
      popover.textContent = text;
      layoutPopover();
      requestAnimationFrame(() => {
        if (destroyed) return;
        layoutPopover();
        popover.focus();
      });
    },

    hide() {
      if (destroyed) return;
      hideAll();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      hideAll();
      button.removeEventListener('click', onButtonClick);
      doc.removeEventListener('mousedown', onDocPointerDown, true);
      doc.removeEventListener('keydown', onDocKeyDown, true);
      host?.remove();
    },
  };
}
