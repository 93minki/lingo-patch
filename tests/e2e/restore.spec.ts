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
import type { Settings } from '../../src/storage/settings';
import { findSegments } from '../../src/core/segment';

declare const chrome: typeof import('wxt/browser').browser;

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
    modifiers: 2,
    key: 's',
    code: 'KeyS',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 1,
  };
  await cdp.send('Input.dispatchKeyEvent', { ...event, type: 'rawKeyDown' });
  await cdp.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
  await cdp.detach();
}

async function contrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    const read = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
    const fg = read(style.color),
      bg = read(style.backgroundColor);
    if (fg.length < 3 || bg.length < 3) return 0;
    const luminance = (rgb: number[]) =>
      rgb.slice(0, 3).reduce((sum, value, index) => {
        const s = value / 255;
        const linear = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
      }, 0);
    return Math.min(
      ...[0, 255].map((base) => {
        const bgAlpha = bg[3] ?? 1,
          fgAlpha = fg[3] ?? 1;
        const surface = bg
          .slice(0, 3)
          .map((value) => value * bgAlpha + base * (1 - bgAlpha));
        const text = fg
          .slice(0, 3)
          .map(
            (value, index) => value * fgAlpha + surface[index]! * (1 - fgAlpha),
          );
        const a = luminance(text),
          b = luminance(surface);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }),
    );
  });
}

test('persistent paragraph cache, original DOM, lazy requests and keyboard modes', async () => {
  for (const browser of ['chrome', 'firefox']) {
    const manifest = await readFile(
      `.output/${browser}-mv3/manifest.json`,
      'utf8',
    );
    expect(JSON.parse(manifest).options_ui).toMatchObject({
      page: 'options.html',
      open_in_tab: true,
    });
    expect(manifest).not.toContain('127.0.0.1');
    expect(
      await readFile(`.output/${browser}-mv3/background.js`, 'utf8'),
    ).not.toContain('lingo-patch-e2e-mock');
    expect(
      await readFile(
        `.output/${browser}-mv3/content-scripts/content.js`,
        'utf8',
      ),
    ).not.toMatch(/lp-secrets|getApiKey/u);
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
    const reconnectBefore = await stats();
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('lp-t')];
      (window as unknown as { reconnectNodes: Element[] }).reconnectNodes =
        nodes;
      (window as unknown as { reconnectRemoved: boolean }).reconnectRemoved =
        false;
      new MutationObserver((changes) => {
        if (
          changes.some((change) =>
            [...change.removedNodes].some(
              (node) =>
                nodes.includes(node as Element) ||
                (node.nodeType === 1 &&
                  nodes.some((item) => (node as Element).contains(item))),
            ),
          )
        )
          (
            window as unknown as { reconnectRemoved: boolean }
          ).reconnectRemoved = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    const worker =
      context!.serviceWorkers()[0] ??
      (await context!.waitForEvent('serviceworker'));
    const extensionPage = await context!.newPage();
    await extensionPage.goto(
      `${worker.url().split('/').slice(0, 3).join('/')}/options.html`,
    );
    const disconnectedPorts = await extensionPage.evaluate(() =>
      chrome.runtime.sendMessage({ scope: 'lp-e2e-ports', disconnect: true }),
    );
    expect(disconnectedPorts.count).toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (
            await extensionPage.evaluate(() =>
              chrome.runtime.sendMessage({ scope: 'lp-e2e-ports' }),
            )
          ).count,
      )
      .toBeGreaterThan(0);
    await expect
      .poll(async () =>
        extensionPage.evaluate(async (url) => {
          const [tab] = await chrome.tabs.query({ url });
          const result = await chrome.runtime.sendMessage({
            scope: 'lp-ui',
            type: 'getTabStatus',
            tabId: tab?.id,
          });
          return result.status?.total ?? 0;
        }, `${origin}/a`),
      )
      .toBeGreaterThan(0);
    await settled(page);
    expect(
      await page.evaluate(() => {
        const state = window as unknown as {
          reconnectNodes: Element[];
          reconnectRemoved: boolean;
        };
        return (
          !state.reconnectRemoved &&
          state.reconnectNodes.every((node) => node.isConnected)
        );
      }),
    ).toBe(true);
    expect((await stats()).requests).toBe(reconnectBefore.requests);
    await extensionPage.close();
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
    if (platform() === 'darwin') {
      const commands = await context!
        .serviceWorkers()[0]!
        .evaluate(() => chrome.commands.getAll());
      expect(
        commands.find((command) => command.name === 'toggle-translate')
          ?.shortcut,
      ).toBe('⌃A');
      expect(
        commands.find((command) => command.name === 'cycle-mode')?.shortcut,
      ).toBe('⌃S');
    }
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
      scenario: 'cycle-mode shortcut',
      additionalCalls: (await stats()).requests - previous.requests,
    });
    expect((await stats()).requests).toBe(previous.requests);
    await page.evaluate(() => document.querySelector('lp-t')!.remove());
    await expect(page.locator('lp-t')).toHaveCount(rendered);
    await settled(page);
    expect((await stats()).requests).toBe(previous.requests);
    counts.push({ scenario: 'DOM translation removal', additionalCalls: 0 });
    const beforeHash = await page.locator('lp-t').first().elementHandle();
    await page.evaluate(() => history.pushState({}, '', '#section'));
    await page.waitForTimeout(700);
    expect(await beforeHash!.evaluate((node) => node.isConnected)).toBe(true);
    counts.push({
      scenario: 'hash-only change keeps nodes',
      additionalCalls: 0,
    });
    const beforeSPA = await page.locator('lp-t').first().elementHandle();
    await page.evaluate(() => history.pushState({}, '', '?spa=1'));
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

test('delayed requests finish after navigation, progress passes clicks, and retranslation refreshes page keys', async () => {
  const profile = await mkdtemp(path.resolve('.output/e2e-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 700 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const control = (delayMs: number) =>
    fetch(`${origin}/control`, {
      method: 'POST',
      body: JSON.stringify({ delayMs }),
    });
  try {
    await context.route('**/*', (route) =>
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith('chrome-extension:')
        ? route.continue()
        : route.abort(),
    );
    const page = context.pages()[0] ?? (await context.newPage());
    const initial = await stats();
    await control(2000);
    await page.goto(`${origin}/pending-a`);
    const progress = page.locator('lp-progress').locator('.pill');
    await expect(progress).toBeVisible();
    await expect(progress).toContainText('번역 중');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await contrast(page, 'lp-progress .pill')).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    await page.emulateMedia({ colorScheme: 'light' });
    const point = await progress.boundingBox();
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.localName,
        { x: point!.x + point!.width / 2, y: point!.y + point!.height / 2 },
      ),
    ).toBe('button');
    await page.mouse.click(
      point!.x + point!.width / 2,
      point!.y + point!.height / 2,
    );
    await expect(
      page.getByRole('button', { name: 'Page action', exact: true }),
    ).toHaveAttribute('data-clicked', 'yes');
    await expect
      .poll(async () => (await stats()).requests - initial.requests)
      .toBe(3);
    const sent = await stats();
    expect(sent.items - initial.items).toBe(120);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const tabId = await worker.evaluate(
      async () =>
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!
          .id!,
    );
    expect(
      await worker.evaluate(
        (id) => chrome.action.getBadgeText({ tabId: id }),
        tabId,
      ),
    ).toBe('170');
    await page.goto(`${origin}/b`);
    await control(0);
    await settled(page);
    const afterB = await stats();
    await page.goBack();
    await expect(page.locator('lp-t[data-lp-state="ready"]')).toHaveCount(170);
    await settled(page);
    const restored = await stats();
    expect(restored.items - afterB.items).toBe(50);
    expect(restored.requests - afterB.requests).toBe(2);
    expect(
      await worker.evaluate(
        (id) => chrome.action.getBadgeText({ tabId: id }),
        tabId,
      ),
    ).toBe('');
    const ui = await context.newPage();
    await ui.goto(
      `${worker.url().split('/').slice(0, 3).join('/')}/options.html`,
    );
    const response = await ui.evaluate(
      (id) =>
        chrome.runtime.sendMessage({
          scope: 'lp-ui',
          type: 'retranslatePage',
          tabId: id,
        }),
      tabId,
    );
    expect(response).toEqual({ ok: true });
    await expect
      .poll(async () => (await stats()).items - restored.items)
      .toBe(170);
    await expect(page.locator('lp-t[data-lp-state="ready"]')).toHaveCount(170);
    await settled(page);
    const refreshed = await stats();
    expect(refreshed.requests - restored.requests).toBe(5);
    console.log(
      JSON.stringify({
        p5ApiCalls: {
          initialA: sent.requests - initial.requests,
          initialB: afterB.requests - sent.requests,
          returnA: restored.requests - afterB.requests,
          retranslate: refreshed.requests - restored.requests,
        },
        p5Items: { initialSent: 120, returnUnsent: 50, retranslate: 170 },
      }),
    );
  } finally {
    await control(0);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('options and popup controls use the real background API without exposing keys', async () => {
  const profile = await mkdtemp(path.resolve('.output/e2e-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1000, height: 800 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await context.route('**/*', (route) =>
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith('chrome-extension:')
        ? route.continue()
        : route.abort(),
    );
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (
              (await chrome.storage.local.get('lp-settings'))['lp-settings'] as
                Settings | undefined
            )?.provider?.model,
        ),
      )
      .toBe('lingo-patch-e2e-mock');
    await worker.evaluate(async () => {
      const value = (await chrome.storage.local.get('lp-settings'))[
        'lp-settings'
      ] as Settings;
      await chrome.storage.local.set({
        'lp-settings': { ...value, provider: null },
      });
    });
    const root = worker.url().split('/').slice(0, 3).join('/');
    const options = await context.newPage();
    await options.goto(`${root}/options.html`);
    await expect(
      options.getByRole('heading', { name: '무료로 시작', exact: true }),
    ).toBeVisible();
    await expect(options.getByLabel('API 키', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    await expect(options.locator('.options__onboarding a')).toHaveCount(6);
    for (const scheme of ['light', 'dark'] as const) {
      await options.emulateMedia({ colorScheme: scheme });
      await options.screenshot({
        path: `.output/p6-options-tab-${scheme}.png`,
        fullPage: true,
      });
      await options.screenshot({
        path: `.output/ui-options-${scheme}.png`,
        fullPage: true,
      });
      for (const selector of [
        '.options',
        '#lp-cache-ttl',
        '#lp-cache-max',
        '#lp-api-key',
        '.options__btn--primary',
        '.options__site-list ~ .options__row button:disabled',
      ])
        expect(await contrast(options, selector)).toBeGreaterThanOrEqual(4.5);
    }
    await options.goto(`${root}/options.html#cache`);
    await expect
      .poll(async () =>
        options
          .locator('#cache')
          .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
      )
      .toBeLessThan(60);
    await options.goto(`${root}/options.html`);
    await options.emulateMedia({ colorScheme: 'light' });
    await options
      .getByRole('combobox', { name: '번역 엔진', exact: true })
      .selectOption('custom');
    await options.getByLabel('Base URL', { exact: true }).fill(`${origin}/v1`);
    await options
      .getByLabel('모델', { exact: true })
      .fill('lingo-patch-e2e-mock');
    await options
      .getByLabel('API 키', { exact: true })
      .fill('local-fake-secret');
    await options.getByRole('button', { name: '키 확인', exact: true }).click();
    await expect(
      options.getByText('키가 확인되었습니다', { exact: true }),
    ).toBeVisible();
    await options.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      options.getByText('저장했습니다', { exact: true }),
    ).toBeVisible();
    await options.getByLabel('API 키', { exact: true }).fill('unsaved-draft');
    await options.getByLabel('목표 언어', { exact: true }).selectOption('en');
    await expect(options.getByLabel('API 키', { exact: true })).toHaveValue(
      'unsaved-draft',
    );
    await options.getByLabel('목표 언어', { exact: true }).selectOption('ko');
    const page = await context.newPage();
    await page.goto(`${origin}/a`);
    await settled(page);
    const tabId = await worker.evaluate(
      async () =>
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!
          .id!,
    );
    const popup = await context.newPage();
    // A standalone popup tab emulates the toolbar popup's active-page lookup.
    await popup.addInitScript((id) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = ((info: {
        active?: boolean;
        currentWindow?: boolean;
      }) =>
        info.active && info.currentWindow
          ? Promise.resolve([{ id }])
          : query(info)) as unknown as typeof chrome.tabs.query;
    }, tabId);
    await popup.goto(`${root}/popup.html`);
    await expect(
      popup.getByRole('button', { name: '번역 끄기', exact: true }),
    ).toBeVisible();
    expect(await popup.locator('body').innerText()).not.toContain(
      'local-fake-secret',
    );
    for (const scheme of ['light', 'dark'] as const) {
      await popup.emulateMedia({ colorScheme: scheme });
      const toggleLayout = await popup
        .locator('.popup__toggle')
        .evaluate((label) => {
          const input = label.querySelector('input')!;
          const text = [...label.childNodes].find(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          )!;
          const range = document.createRange();
          range.selectNodeContents(text);
          const rects = range.getClientRects();
          return {
            lines: rects.length,
            inputRight: input.getBoundingClientRect().right,
            textLeft: rects[0]!.left,
            inputWidth: input.getBoundingClientRect().width,
          };
        });
      expect(toggleLayout.lines).toBe(1);
      expect(toggleLayout.inputRight).toBeLessThan(toggleLayout.textLeft);
      expect(toggleLayout.inputWidth).toBeLessThan(30);
      await popup.screenshot({
        path: `.output/ui-popup-main-${scheme}.png`,
        fullPage: true,
      });
      expect(await contrast(popup, '.popup')).toBeGreaterThanOrEqual(4.5);
      if (await popup.locator('.popup__btn--primary').count())
        expect(
          await contrast(popup, '.popup__btn--primary'),
        ).toBeGreaterThanOrEqual(4.5);
    }
    await popup.emulateMedia({ colorScheme: 'light' });
    await popup.getByRole('button', { name: '설정', exact: true }).click();
    await expect(popup.getByRole('main', { name: '번역 설정' })).toBeVisible();
    await expect(popup.getByText(/고급 설정 페이지에서 구성/)).toBeVisible();
    await popup
      .getByRole('combobox', { name: '번역 엔진', exact: true })
      .selectOption('gemini');
    for (const scheme of ['light', 'dark'] as const) {
      await popup.emulateMedia({ colorScheme: scheme });
      await popup.screenshot({
        path: `.output/ui-popup-settings-${scheme}.png`,
        fullPage: true,
      });
      expect(await contrast(popup, '.popup')).toBeGreaterThanOrEqual(4.5);
      expect(
        await contrast(popup, 'input[type=password]'),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await contrast(popup, '.lp-settings-btn--primary'),
      ).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(popup, 'select:disabled')).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    const tabCount = context.pages().length;
    await popup
      .getByRole('button', { name: '용어집 관리', exact: true })
      .click();
    await expect(options).toHaveURL(`${root}/options.html#glossary`);
    await expect
      .poll(async () =>
        options
          .locator('#glossary')
          .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
      )
      .toBeLessThan(60);
    expect(context.pages()).toHaveLength(tabCount);
    await popup.bringToFront();
    await popup.emulateMedia({ colorScheme: 'light' });
    await popup.getByRole('button', { name: '← 뒤로', exact: true }).click();
    await popup.getByRole('button', { name: '원문만', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-lp-mode',
      'original',
    );
    await popup.getByRole('button', { name: '이중 언어', exact: true }).click();
    await popup.getByRole('button', { name: '번역 끄기', exact: true }).click();
    await expect(page.locator('lp-t')).toHaveCount(0);
    await popup.getByRole('button', { name: '지금 번역', exact: true }).click();
    await settled(page);
    const before = await stats();
    const tabState = await popup.evaluate(
      (id) =>
        chrome.runtime.sendMessage({
          scope: 'lp-ui',
          type: 'getTabStatus',
          tabId: id,
        }),
      tabId,
    );
    const expectedItems = tabState.status.total as number;
    expect(expectedItems).toBe(102);
    popup.once('dialog', (dialog) => {
      expect(dialog.message()).toContain(`${expectedItems}개`);
      return dialog.accept();
    });
    await popup
      .getByRole('button', { name: '이 페이지 다시 번역', exact: true })
      .click();
    await expect
      .poll(async () => (await stats()).items - before.items)
      .toBe(expectedItems);
    await expect(page.locator('lp-t[data-lp-state="ready"]')).toHaveCount(122);
    await settled(page);
    const after = await stats();
    console.log(
      JSON.stringify({
        p5UiRetranslate: {
          requests: after.requests - before.requests,
          items: after.items - before.items,
        },
      }),
    );
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Next.js sticky header is skipped and short sidebar labels render compact', async () => {
  const profile = await mkdtemp(path.resolve('.output/e2e-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 700 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await context.route('**/*', (route) =>
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith('chrome-extension:')
        ? route.continue()
        : route.abort(),
    );
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${origin}/nextjs`);
    const header = page.locator('header').first();
    const sidebarItem = page
      .locator('aside a')
      .filter({ hasText: /^Installation$/ })
      .first()
      .locator('xpath=ancestor::li[1]');
    const sidebarHeight = await sidebarItem.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    const before = await header.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    console.log('header height', before);
    expect(before).toBeLessThanOrEqual(120);
    await settled(page);
    expect(
      await header.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBe(before);
    await expect(header.locator('lp-t')).toHaveCount(0);
    await expect(
      page.locator('aside lp-t[data-lp-display="compact"]').first(),
    ).toBeVisible();
    await expect(
      sidebarItem.locator('lp-t[data-lp-display="compact"]'),
    ).toBeVisible();
    expect(
      await sidebarItem.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBe(sidebarHeight);
    const tooNarrow = await page
      .locator('lp-t[data-lp-state="ready"]')
      .evaluateAll(
        (nodes) =>
          nodes.filter((node) => {
            const style = getComputedStyle(node);
            const width = node.getBoundingClientRect().width;
            return (
              (node.textContent?.trim().length ?? 0) >= 2 &&
              width > 0 &&
              width < parseFloat(style.fontSize) * 2
            );
          }).length,
      );
    expect(tooNarrow).toBe(0);
    await page.screenshot({ path: '.output/layout-nextjs.png' });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const options = await context.newPage();
    await options.goto(
      `${worker.url().split('/').slice(0, 3).join('/')}/options.html`,
    );
    const toggle = options.getByRole('checkbox', {
      name: '상단 고정 바 건너뛰기',
    });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect.poll(() => header.locator('lp-t').count()).toBeGreaterThan(0);
    await toggle.check();
    await expect(header.locator('lp-t')).toHaveCount(0);
    await options.close();
    await page.goto(`${origin}/a`);
    await settled(page);
    await page.screenshot({ path: '.output/layout-react.png' });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('P6 glossary, selection translation and cache transfer', async () => {
  const profile = await mkdtemp(path.resolve('.output/e2e-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 700 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await context.route('**/*', (route) =>
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith('chrome-extension:')
        ? route.continue()
        : route.abort(),
    );
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const root = worker.url().split('/').slice(0, 3).join('/');
    const options = await context.newPage();
    await options.goto(`${root}/options.html`);
    await options.evaluate(() =>
      chrome.storage.local.set({
        'lp-glossary': { global: [], sites: {}, useDefaults: false },
      }),
    );
    await options.reload();
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${origin}/p6`);
    await expect(page.locator('#with-props lp-t')).toContainText('[KO]');
    await expect(page.locator('#other lp-t')).toContainText('[KO]');
    await settled(page);
    await page.evaluate(() => {
      (
        window as unknown as { otherTranslation: Element | null }
      ).otherTranslation = document.querySelector('#other lp-t');
    });
    const initial = await stats();
    await options.getByLabel('전역 용어집 추가 용어').fill('props');
    await options
      .getByRole('region', { name: '전역 용어집' })
      .getByRole('button', { name: '항목 추가' })
      .click();
    await options.getByRole('button', { name: '용어집 저장' }).click();
    await expect
      .poll(async () => (await stats()).items - initial.items)
      .toBe(1);
    await expect(page.locator('#with-props lp-t')).toContainText('[KO]');
    await settled(page);
    expect(
      await page.evaluate(
        () =>
          document.querySelector('#other lp-t') ===
          (window as unknown as { otherTranslation: Element }).otherTranslation,
      ),
    ).toBe(true);
    const details = (await (await fetch(`${origin}/stats`)).json()) as {
      batches: string[][];
      glossaryBatches: { term: string }[][];
    };
    expect(details.batches.at(-1)).toEqual(['These props describe behavior.']);
    expect(details.glossaryBatches.at(-1)?.map((item) => item.term)).toEqual([
      'props',
    ]);
    for (const scheme of ['light', 'dark'] as const) {
      await options.emulateMedia({ colorScheme: scheme });
      await options.screenshot({
        path: `.output/p6-options-${scheme}.png`,
        fullPage: true,
      });
    }
    const download = options.waitForEvent('download');
    await options.getByRole('button', { name: '번역 캐시 내보내기' }).click();
    const file = await download;
    const cachePath = path.resolve('.output/p6-cache.jsonl.gz');
    await file.saveAs(cachePath);
    options.once('dialog', (dialog) => void dialog.accept());
    await options
      .getByRole('button', { name: '전체 삭제', exact: true })
      .click();
    await options.locator('input[type=file]').setInputFiles(cachePath);
    await expect(
      options.getByText(/가져옴 \d+ · 건너뜀/).first(),
    ).toBeVisible();
    const beforeReload = await stats();
    await page.reload();
    await settled(page);
    expect((await stats()).requests).toBe(beforeReload.requests);
    const tabId = await options.evaluate(
      async (url) => (await chrome.tabs.query({ url }))[0]!.id!,
      `${origin}/p6`,
    );
    await options.evaluate(
      (id) =>
        chrome.runtime.sendMessage({
          scope: 'lp-ui',
          type: 'setAutoSite',
          tabId: id,
          enabled: false,
        }),
      tabId,
    );
    await expect(page.locator('lp-t')).toHaveCount(0);
    await page.bringToFront();
    await page.evaluate(() => {
      const text = document.querySelector('#other')!.firstChild!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      text.parentElement!.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true }),
      );
    });
    const overlay = page.locator('lp-selection-overlay');
    await overlay.getByRole('button', { name: '선택한 텍스트 번역' }).click();
    await expect(overlay.getByRole('dialog')).toContainText('[KO]');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `.output/p6-selection-${scheme}.png` });
    }
    await page.keyboard.press('Escape');
    await expect(overlay.getByRole('dialog')).not.toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('removing keys stops new requests but keeps cached translations', async () => {
  const profile = await mkdtemp(path.resolve('.output/e2e-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 700 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await context.route('**/*', (route) =>
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith('chrome-extension:')
        ? route.continue()
        : route.abort(),
    );
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const extensionRoot = worker.url().split('/').slice(0, 3).join('/');
    const options = await context.newPage();
    await options.goto(`${extensionRoot}/options.html`);
    await expect(options.locator('#lp-api-key')).toBeVisible();
    await options.evaluate(() =>
      chrome.storage.local.set({
        'lp-secrets': {
          'openai-compatible': 'local-fake-secret',
          gemini: 'other-fake-secret',
        },
      }),
    );
    await options.reload();
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${origin}/p6`);
    await settled(page);
    const before = await stats();
    const tabId = await options.evaluate(
      async (url) => (await chrome.tabs.query({ url }))[0]!.id!,
      `${origin}/p6`,
    );
    options.once('dialog', (dialog) => void dialog.accept());
    await options.getByRole('button', { name: '키 삭제', exact: true }).click();
    await expect
      .poll(async () =>
        options.evaluate(
          async (id) =>
            (
              await chrome.runtime.sendMessage({
                scope: 'lp-ui',
                type: 'getTabStatus',
                tabId: id,
              })
            ).status?.configured,
          tabId,
        ),
      )
      .toBe(false);
    const remaining = await options.evaluate(
      async () => (await chrome.storage.local.get('lp-secrets'))['lp-secrets'],
    );
    expect(remaining).not.toHaveProperty('openai-compatible');
    expect(remaining).toHaveProperty('gemini', 'other-fake-secret');
    await page.reload();
    await expect(page.locator('#with-props lp-t')).toContainText('[KO]');
    expect((await stats()).requests).toBe(before.requests);
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = 'New uncached text after deletion.';
      document.body.append(p);
    });
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.querySelector('lp-progress')?.shadowRoot?.textContent ??
            '',
        ),
      )
      .toContain('설정');
    expect((await stats()).requests).toBe(before.requests);
    options.once('dialog', (dialog) => void dialog.accept());
    await options
      .getByRole('button', { name: '저장된 모든 API 키 삭제' })
      .click();
    await expect
      .poll(async () =>
        options.evaluate(
          async () =>
            (await chrome.storage.local.get('lp-secrets'))['lp-secrets'],
        ),
      )
      .toBeUndefined();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
