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
  expect(TRANSLATION_CSS).toContain('html[data-lp-mode="original"] lp-t');
  expect(TRANSLATION_CSS).toContain('display: none !important');
  expect(TRANSLATION_CSS).toContain(
    'html[data-lp-mode="translation"] [data-lp-src-hidden]',
  );
  expect(TRANSLATION_CSS).toContain('font-size: 0');
  expect(TRANSLATION_CSS).toContain('font-size: var(--lp-fs)');
  expect(TRANSLATION_CSS).toContain('lp-t[data-lp-state="error"]');
  expect(TRANSLATION_CSS).toContain('lp-t[data-lp-state="pending"]');
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
  lp.textContent = '번역';
  block.appendChild(lp);
  document.body.appendChild(block);
  ensureStyle(document);
  expect(getComputedStyle(block).fontSize).toBe('0px');
  expect(getComputedStyle(lp).fontSize).toBe('20px');
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
