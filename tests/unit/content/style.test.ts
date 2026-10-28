import { beforeEach, expect, test } from 'vitest';
import { ensureStyle, TRANSLATION_CSS } from '../../../src/content/style';

beforeEach(() => {
  document.getElementById('lp-style')?.remove();
  document.documentElement.removeAttribute('data-lp-mode');
  document.body.innerHTML = '';
});

test('ensureStyle inserts a single lp-style element and is idempotent', () => {
  const bodyBefore = document.body.innerHTML;
  const modeBefore = document.documentElement.getAttribute('data-lp-mode');
  ensureStyle(document);
  ensureStyle(document);
  const styles = document.querySelectorAll('#lp-style');
  expect(styles).toHaveLength(1);
  expect(styles[0]!.textContent).toBe(TRANSLATION_CSS);
  expect(document.body.innerHTML).toBe(bodyBefore);
  expect(document.documentElement.getAttribute('data-lp-mode')).toBe(
    modeBefore,
  );
});

test('TRANSLATION_CSS defines base, display, mode, and state rules', () => {
  expect(TRANSLATION_CSS).toContain('font: inherit');
  expect(TRANSLATION_CSS).toContain('opacity: 0.85');
  expect(TRANSLATION_CSS).toContain('lp-t[data-lp-display="block"]');
  expect(TRANSLATION_CSS).toContain('margin-top: 0.25em');
  expect(TRANSLATION_CSS).toContain('lp-t[data-lp-display="inline"]');
  expect(TRANSLATION_CSS).toContain('margin-left: 0.4em');
  expect(TRANSLATION_CSS).toContain('lp-t[data-lp-display="compact"]');
  expect(TRANSLATION_CSS).toContain('margin-left: 0.5em');
  expect(TRANSLATION_CSS).toContain('white-space: nowrap');
  expect(TRANSLATION_CSS).toContain(
    'lp-t[data-lp-layout="horizontal"][data-lp-display="compact"]',
  );
  expect(TRANSLATION_CSS).toContain('flex: none');
  expect(TRANSLATION_CSS).toContain(
    'lp-t[data-lp-layout="horizontal"][data-lp-display="inline"]',
  );
  expect(TRANSLATION_CSS).toContain('flex: 1 1 auto');
  expect(TRANSLATION_CSS).toContain('min-width: 0');
  expect(TRANSLATION_CSS).toContain('html[data-lp-mode="original"] lp-t');
  expect(TRANSLATION_CSS).toContain('display: none !important');
  expect(TRANSLATION_CSS).toContain(
    'html[data-lp-mode="translation"] [data-lp-src-hidden]',
  );
  expect(TRANSLATION_CSS).toContain('line-height: 0 !important');
  expect(TRANSLATION_CSS).toContain('[data-lp-src-hidden] > [data-lp-src]');
  expect(TRANSLATION_CSS).toContain('display: none !important');
  expect(TRANSLATION_CSS).toContain('[data-lp-src-hidden] > lp-t');
  expect(TRANSLATION_CSS).toContain('line-height: var(--lp-lh) !important');
  expect(TRANSLATION_CSS).toContain('margin-top: 0 !important');
  expect(TRANSLATION_CSS).toContain(
    '[data-lp-src-hidden] > lp-t[data-lp-display="compact"]',
  );
  expect(TRANSLATION_CSS).toContain('li[data-lp-src-hidden]::marker');
  expect(TRANSLATION_CSS).toContain('lp-t[data-lp-state="error"]');
  expect(TRANSLATION_CSS).toContain('lp-t[data-lp-state="pending"]');
});

test('compact and horizontal flex rules apply in bilingual layout', () => {
  ensureStyle(document);
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.flexDirection = 'row';
  document.body.appendChild(row);

  const compact = document.createElement('lp-t');
  compact.dataset.lpDisplay = 'compact';
  compact.dataset.lpLayout = 'horizontal';
  compact.textContent = '짧은 번역';
  row.appendChild(compact);

  const inline = document.createElement('lp-t');
  inline.dataset.lpDisplay = 'inline';
  inline.dataset.lpLayout = 'horizontal';
  inline.textContent = '긴 번역 텍스트';
  row.appendChild(inline);

  expect(getComputedStyle(compact).display).toBe('inline');
  expect(getComputedStyle(compact).marginLeft).toBe('8px');
  expect(getComputedStyle(compact).whiteSpace).toBe('nowrap');
  expect(getComputedStyle(compact).flex).toBe('0 0 auto');

  expect(getComputedStyle(inline).flex).toBe('1 1 auto');
  expect(getComputedStyle(inline).minWidth).toMatch(/^0(px)?$/);
});

test('original mode hides lp-t without touching source nodes', () => {
  document.documentElement.setAttribute('data-lp-mode', 'original');
  document.body.innerHTML = '<p class="src">Source text</p>';
  const source = document.body.firstElementChild!;
  const lp = document.createElement('lp-t');
  lp.textContent = '번역';
  document.body.appendChild(lp);
  ensureStyle(document);
  expect(getComputedStyle(lp).display).toBe('none');
  expect(source.textContent).toBe('Source text');
  expect(source.className).toBe('src');
});

test('translation mode hides source text via font-size while restoring lp-t size', () => {
  document.documentElement.setAttribute('data-lp-mode', 'translation');
  const block = document.createElement('p');
  block.setAttribute('data-lp-src-hidden', '');
  block.textContent = '원문';
  const lp = document.createElement('lp-t');
  lp.style.setProperty('--lp-fs', '20px');
  lp.style.setProperty('--lp-lh', '24px');
  lp.textContent = '번역';
  block.appendChild(lp);
  document.body.appendChild(block);
  ensureStyle(document);
  expect(getComputedStyle(block).fontSize).toBe('0px');
  expect(getComputedStyle(block).lineHeight).toBe('0');
  expect(getComputedStyle(lp).fontSize).toBe('20px');
  expect(getComputedStyle(lp).lineHeight).toBe('24px');
});

test('translation mode keeps compact nowrap and horizontal flex on direct lp-t', () => {
  document.documentElement.setAttribute('data-lp-mode', 'translation');
  ensureStyle(document);
  const block = document.createElement('div');
  block.setAttribute('data-lp-src-hidden', '');
  block.style.display = 'flex';
  block.style.flexDirection = 'row';
  document.body.appendChild(block);

  const compact = document.createElement('lp-t');
  compact.dataset.lpDisplay = 'compact';
  compact.dataset.lpLayout = 'horizontal';
  compact.style.setProperty('--lp-fs', '16px');
  compact.textContent = '번역';
  block.appendChild(compact);

  expect(getComputedStyle(compact).marginLeft).toBe('0px');
  expect(getComputedStyle(compact).whiteSpace).toBe('nowrap');
  expect(getComputedStyle(compact).flex).toBe('0 0 auto');
});

test('pending and error lp-t states follow layout rules', () => {
  ensureStyle(document);
  const pending = document.createElement('lp-t');
  pending.dataset.lpState = 'pending';
  document.body.appendChild(pending);
  expect(getComputedStyle(pending).display).toBe('none');

  const error = document.createElement('lp-t');
  error.dataset.lpState = 'error';
  error.textContent = '⚠';
  document.body.appendChild(error);
  expect(getComputedStyle(error).display).not.toBe('none');
  expect(error.textContent).toBe('⚠');
});
