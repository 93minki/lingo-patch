import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createProgress } from '../../../src/content/progress';
import { strings } from '../../../src/ui/strings';

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = '<head></head><body></body>';
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function setup() {
  const onOpenOptions = vi.fn();
  const progress = createProgress(document, onOpenOptions);
  const host = document.getElementById('lp-progress')!;
  const pill = host.shadowRoot!.querySelector('.pill') as HTMLDivElement;
  const message = host.shadowRoot!.querySelector('.message') as HTMLSpanElement;
  const link = host.shadowRoot!.querySelector(
    '.open-options',
  ) as HTMLButtonElement;
  return { progress, host, pill, message, link, onOpenOptions };
}

test('creates a single ignored shadow host with pointer-events disabled on the pill', () => {
  const { host, pill, link } = setup();
  expect(host.tagName.toLowerCase()).toBe('lp-progress');
  expect(host.id).toBe('lp-progress');
  expect(host.getAttribute('data-lp-ignore')).toBe('');
  expect(getComputedStyle(host).pointerEvents).toBe('none');
  expect(getComputedStyle(pill).pointerEvents).toBe('none');
  expect(pill.getAttribute('role')).toBe('status');
  expect(pill.getAttribute('aria-live')).toBe('polite');
  expect(getComputedStyle(link).pointerEvents).toBe('auto');
});

test('shows progress only after 300ms while work is in flight', async () => {
  const { progress, pill, message } = setup();
  progress.update({ requested: 4, completed: 1 });
  await tick(299);
  expect(pill.classList.contains('visible')).toBe(false);
  await tick(1);
  expect(pill.classList.contains('visible')).toBe(true);
  expect(message.textContent).toBe(strings.progress.translating(1, 4));
});

test('hides fast completions that finish before the 300ms delay', async () => {
  const { progress, pill } = setup();
  progress.update({ requested: 2, completed: 0 });
  await tick(100);
  progress.update({ requested: 2, completed: 2 });
  await tick(500);
  expect(pill.classList.contains('visible')).toBe(false);
});

test('shows completion for 1500ms then fades out', async () => {
  const { progress, pill, message } = setup();
  progress.update({ requested: 2, completed: 0 });
  await tick(300);
  progress.update({ requested: 2, completed: 2 });
  expect(message.textContent).toBe(strings.progress.done);
  await tick(1500);
  expect(pill.classList.contains('fade-out')).toBe(true);
  await tick(300);
  expect(pill.classList.contains('visible')).toBe(false);
});

test('does not show anything for cache-only updates', () => {
  const { progress, pill } = setup();
  progress.update({ requested: 0, completed: 0 });
  expect(pill.classList.contains('visible')).toBe(false);
});

test('renders auth errors with a clickable settings action', async () => {
  const { progress, message, link, onOpenOptions } = setup();
  progress.update({ requested: 3, completed: 1, error: 'auth' });
  expect(message.textContent).toBe(`${strings.progress.authError} · `);
  expect(link.hidden).toBe(false);
  link.click();
  expect(onOpenOptions).toHaveBeenCalledOnce();
});

test('renders rate limit errors without a settings action', () => {
  const { progress, message, link } = setup();
  progress.update({ requested: 1, completed: 0, error: 'rate_limit' });
  expect(message.textContent).toBe(strings.progress.rateLimit);
  expect(link.hidden).toBe(true);
});

test('does not extend the completion timer on duplicate done updates', async () => {
  const { progress, pill } = setup();
  progress.update({ requested: 2, completed: 0 });
  await tick(300);
  progress.update({ requested: 2, completed: 2 });
  progress.update({ requested: 2, completed: 2 });
  progress.update({ requested: 2, completed: 2 });
  await tick(1500);
  expect(pill.classList.contains('fade-out')).toBe(true);
  await tick(300);
  expect(pill.classList.contains('visible')).toBe(false);
});

test('destroy clears pending timers and removes the host', async () => {
  const { progress } = setup();
  progress.update({ requested: 2, completed: 0 });
  progress.destroy();
  expect(document.getElementById('lp-progress')).toBeNull();
  await tick(1000);
});
