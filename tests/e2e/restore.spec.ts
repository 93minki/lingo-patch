import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { platform } from 'node:os';
import { Window } from 'happy-dom';
import { findSegments } from '../../src/core/segment';

const origin = 'http://127.0.0.1:4174';
const extension = path.resolve('.output/chrome-mv3-e2e');
type Stats = { requests: number; items: number; lastCall: number };
const stats = async (): Promise<Stats> =>
  (await fetch(`${origin}/stats`)).json();
async function settled(page: Page) {
  await expect(
    page.locator('lp-t[data-lp-state="ready"]').first(),
  ).toContainText('[KO]');
  await expect(page.locator('lp-t[data-lp-state="pending"]')).toHaveCount(0);
  await expect
    .poll(async () => Date.now() - (await stats()).lastCall)
    .toBeGreaterThan(600);
}
async function sourceUnchanged(page: Page) {
  expect(
    await page.evaluate(() => {
      const snapshot = (
        window as unknown as {
          lpSource: {
            texts: [Node, string | null][];
            attrs: [Element, [string, string][]][];
            text: string | null;
          };
        }
      ).lpSource;
      const copy = document.body.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('lp-t').forEach((node) => node.remove());
      return (
        snapshot.texts.every(
          ([node, text]) => node.isConnected && node.textContent === text,
        ) &&
        snapshot.attrs.every(
          ([node, attrs]) =>
            node.isConnected &&
            JSON.stringify(
              [...node.attributes]
                .filter((attr) => !attr.name.startsWith('data-lp-'))
                .map((attr) => [attr.name, attr.value]),
            ) === JSON.stringify(attrs),
        ) &&
        copy.textContent === snapshot.text
      );
    }),
  ).toBe(true);
}

async function cycleMode(page: Page, context: BrowserContext) {
  if (platform() !== 'darwin') return page.keyboard.press('Alt+KeyS');
  // macOS extension accelerators need native key codes omitted by Playwright.
  const cdp = await context.newCDPSession(page);
  const event = {
    modifiers: 1,
    key: 's',
    code: 'KeyS',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 1,
  };
  await cdp.send('Input.dispatchKeyEvent', { ...event, type: 'rawKeyDown' });
  await cdp.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
  await cdp.detach();
}

test('persistent paragraph cache, original DOM, lazy requests and keyboard modes', async () => {
  for (const browser of ['chrome', 'firefox']) {
    const manifest = await readFile(
      `.output/${browser}-mv3/manifest.json`,
      'utf8',
    );
    expect(manifest).not.toContain('127.0.0.1');
    expect(
      await readFile(`.output/${browser}-mv3/background.js`, 'utf8'),
    ).not.toContain('lingo-patch-e2e-mock');
  }
  expect(await readFile(`${extension}/manifest.json`, 'utf8')).toContain(
    'http://127.0.0.1/*',
  );
  const profile = await mkdtemp(path.resolve('.output/e2e-profile-'));
  let context: BrowserContext | undefined;
  const launch = async () => {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1100, height: 700 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(origin) ||
        url.startsWith('chrome-extension:') ||
        url.startsWith('data:')
        ? route.continue()
        : route.abort();
    });
    await context.addInitScript(() => {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
          );
          const texts: [Node, string | null][] = [];
          let node: Node | null;
          while ((node = walker.nextNode()))
            texts.push([node, node.textContent]);
          (window as unknown as { lpSource: unknown }).lpSource = {
            texts,
            text: document.body.textContent,
            attrs: [...document.body.querySelectorAll('*')].map((element) => [
              element,
              [...element.attributes].map((attr) => [attr.name, attr.value]),
            ]),
          };
        },
        { once: true },
      );
    });
    return context.pages()[0] ?? (await context.newPage());
  };
  const counts: { scenario: string; additionalCalls: number }[] = [];
  try {
    let page = await launch();
    const start = await stats();
    await page.goto(`${origin}/a`);
    await settled(page);
    await sourceUnchanged(page);
    await expect(page.locator('pre lp-t')).toHaveCount(0);
    let previous = await stats();
    counts.push({
      scenario: 'A initial',
      additionalCalls: previous.requests - start.requests,
    });
    const dom = new Window();
    dom.document.write(
      await readFile('tests/fixtures/react-learn.html', 'utf8'),
    );
    const fullCount = findSegments(
      dom.document.body as unknown as HTMLElement,
      { targetLang: 'ko' },
    ).length;
    expect(previous.items - start.items).toBeLessThan(fullCount);
    console.log(
      JSON.stringify({
        requestedItems: previous.items - start.items,
        totalSegments: fullCount,
      }),
    );
    await dom.happyDOM.close();
    await page.goto(`${origin}/b`);
    await settled(page);
    const onB = await stats();
    counts.push({
      scenario: 'B initial',
      additionalCalls: onB.requests - previous.requests,
    });
    previous = onB;
    await page.goBack();
    await settled(page);
    expect((await stats()).requests).toBe(previous.requests);
    counts.push({ scenario: 'A back', additionalCalls: 0 });
    await page.reload();
    await settled(page);
    await sourceUnchanged(page);
    expect((await stats()).requests).toBe(previous.requests);
    counts.push({ scenario: 'A reload', additionalCalls: 0 });
    await context!.close();
    context = undefined;
    page = await launch();
    await page.goto(`${origin}/a`);
    await settled(page);
    expect((await stats()).requests).toBe(previous.requests);
    counts.push({ scenario: 'A profile restart', additionalCalls: 0 });
    await expect(page.locator('html')).toHaveAttribute(
      'data-lp-mode',
      'bilingual',
    );
    const rendered = await page.locator('lp-t').count();
    for (const mode of ['translation', 'original', 'bilingual']) {
      await page.bringToFront();
      await cycleMode(page, context!);
      await expect(page.locator('html')).toHaveAttribute('data-lp-mode', mode);
      await expect(page.locator('lp-t')).toHaveCount(rendered);
      if (mode === 'original')
        await expect(page.locator('lp-t').first()).toBeHidden();
    }
    await sourceUnchanged(page);
    counts.push({
      scenario: 'Alt+S modes',
      additionalCalls: (await stats()).requests - previous.requests,
    });
    expect((await stats()).requests).toBe(previous.requests);
    await page.evaluate(() => document.querySelector('lp-t')!.remove());
    await expect(page.locator('lp-t')).toHaveCount(rendered);
    await settled(page);
    expect((await stats()).requests).toBe(previous.requests);
    counts.push({ scenario: 'DOM translation removal', additionalCalls: 0 });
    const beforeSPA = await page.locator('lp-t').first().elementHandle();
    await page.evaluate(() => history.pushState({}, '', '#spa'));
    await expect
      .poll(() => beforeSPA!.evaluate((node) => node.isConnected))
      .toBe(false);
    await settled(page);
    expect((await stats()).requests).toBe(previous.requests);
    counts.push({ scenario: 'SPA same content', additionalCalls: 0 });
    console.log(JSON.stringify({ apiCalls: counts }));
    await test.info().attach('api-counts', {
      body: JSON.stringify(counts, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
