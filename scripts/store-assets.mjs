/* global process, setTimeout, clearTimeout, chrome, document, console */
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('store/assets');
const origin = 'http://127.0.0.1:4174';
const articleOrigin = 'http://fieldnotes.example:4174';
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.resolve('.output/store-profile-'));
const extension = await mkdtemp(path.resolve('.output/store-extension-'));
await cp(path.resolve('.output/chrome-mv3-e2e'), extension, {
  recursive: true,
});
const manifestPath = path.join(extension, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.host_permissions.push('http://fieldnotes.example/*');
await writeFile(manifestPath, JSON.stringify(manifest));
const server = spawn(process.execPath, ['tests/e2e/server.mjs', '--store'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverError = '';
server.stderr.on('data', (chunk) => {
  serverError += chunk;
});
let context;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Mock server did not start')),
      10000,
    );
    server.stdout.once('data', () => {
      clearTimeout(timer);
      resolve();
    });
    server.once('exit', () => {
      clearTimeout(timer);
      reject(new Error(`Mock server failed: ${serverError}`));
    });
  });
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--host-resolver-rules=MAP fieldnotes.example 127.0.0.1',
      `--unsafely-treat-insecure-origin-as-secure=${articleOrigin}`,
      '--no-proxy-server',
    ],
  });
  await context.route('**/*', (route) =>
    route.request().url().startsWith(origin) ||
    route.request().url().startsWith(articleOrigin) ||
    route.request().url().startsWith('chrome-extension:')
      ? route.continue()
      : route.abort(),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const root = worker.url().split('/').slice(0, 3).join('/');
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await chrome.storage.local.get('lp-settings'))['lp-settings']
            ?.provider?.model,
      ),
    )
    .toBe('lingo-patch-e2e-mock');
  await worker.evaluate(async () => {
    const { 'lp-settings': settings } =
      await chrome.storage.local.get('lp-settings');
    await chrome.storage.local.set({
      'lp-settings': { ...settings, autoSites: ['fieldnotes.example'] },
    });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${articleOrigin}/store`);
  await expect(page.locator('lp-t[data-lp-state="ready"]')).toHaveCount(6);
  await expect(page.locator('lp-t[data-lp-state="pending"]')).toHaveCount(0);
  await expect(page.locator('article')).toContainText(
    '웹을 더 차분하게 탐색하는 방법',
  );
  await page.screenshot({ path: path.join(output, '01-bilingual.png') });
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  const popup = await context.newPage();
  await popup.addInitScript((id) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info) =>
      info.active && info.currentWindow
        ? Promise.resolve([{ id }])
        : query(info);
  }, tabId);
  await popup.goto(`${root}/popup.html`);
  await expect(
    popup.getByRole('button', { name: '번역 끄기', exact: true }),
  ).toBeVisible();
  await expect(popup.locator('.popup__host')).toHaveText('fieldnotes.example');
  await popup.getByRole('button', { name: '번역문만', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-lp-mode',
    'translation',
  );
  await page.screenshot({ path: path.join(output, '02-translation-only.png') });
  await popup.getByRole('button', { name: '이중 언어', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-lp-mode',
    'bilingual',
  );
  const popupImage = await popup.locator('.popup').screenshot();
  await page.evaluate((data) => {
    const image = document.createElement('img');
    image.src = `data:image/png;base64,${data}`;
    image.setAttribute('translate', 'no');
    Object.assign(image.style, {
      position: 'fixed',
      right: '22px',
      top: '18px',
      zIndex: '2147483647',
      borderRadius: '10px',
      boxShadow: '0 12px 45px #0004',
    });
    document.body.append(image);
  }, popupImage.toString('base64'));
  await page.screenshot({ path: path.join(output, '03-popup.png') });
  await worker.evaluate(async () => {
    const { 'lp-settings': settings, 'lp-usage': usage } =
      await chrome.storage.local.get(['lp-settings', 'lp-usage']);
    const updatedUsage = Object.fromEntries(
      Object.entries(usage).map(([date, providers]) => [
        date,
        {
          gemini: {
            'gemini-2.5-pro':
              providers['openai-compatible']['lingo-patch-e2e-mock'],
          },
        },
      ]),
    );
    await chrome.storage.local.set({
      'lp-settings': {
        ...settings,
        provider: { provider: 'gemini', model: 'gemini-2.5-pro' },
      },
      'lp-usage': updatedUsage,
    });
  });
  const options = await context.newPage();
  await options.goto(`${root}/options.html`);
  await expect(options.locator('#lp-api-key')).toBeVisible();
  await expect(options.locator('#lp-engine')).toHaveValue('gemini');
  await expect(options.locator('#lp-model')).toHaveValue('gemini-2.5-pro');
  await options.locator('#lp-api-key').fill('sample-key-for-screenshot');
  await expect(options.locator('#lp-api-key')).toHaveAttribute(
    'type',
    'password',
  );
  await expect(
    options.getByRole('button', { name: '키 삭제', exact: true }),
  ).toHaveCount(0);
  await options.screenshot({ path: path.join(output, '04-options.png') });
  await expect
    .poll(async () => options.locator('#usage').innerText())
    .toContain('123');
  await expect(options.locator('#usage')).toContainText('gemini-2.5-pro');
  await options.locator('#usage').scrollIntoViewIfNeeded();
  await options.evaluate(() =>
    document.querySelector('#usage').scrollIntoView({ block: 'start' }),
  );
  await options.screenshot({ path: path.join(output, '05-usage.png') });
  const icon = (await readFile('public/icon/128.png')).toString('base64');
  const promo = await context.newPage();
  await promo.setViewportSize({ width: 440, height: 280 });
  await promo.setContent(
    `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:440px;height:280px;background:linear-gradient(135deg,#eaf5ee,#d6eae1);display:flex;align-items:center;justify-content:center;text-align:center;font-family:system-ui,-apple-system,sans-serif;color:#173c32}.icon{width:88px;height:88px;border-radius:20px;box-shadow:0 10px 25px #1c594334}h1{font-size:29px;letter-spacing:-.03em;margin:14px 0 7px}p{font-size:15px;font-weight:600;color:#3e6c5b;margin:0}</style><main><img class="icon" src="data:image/png;base64,${icon}"><h1>lingo-patch</h1><p>AI 이중 언어 번역 · 재방문은 캐시로</p></main>`,
  );
  await promo.screenshot({ path: path.join(output, 'promo-440x280.png') });
  for (const [file, width, height] of [
    ...[
      '01-bilingual.png',
      '02-translation-only.png',
      '03-popup.png',
      '04-options.png',
      '05-usage.png',
    ].map((name) => [name, 1280, 800]),
    ['promo-440x280.png', 440, 280],
  ]) {
    const png = await readFile(path.join(output, file));
    if (
      png.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
      png.readUInt32BE(16) !== width ||
      png.readUInt32BE(20) !== height
    )
      throw new Error(`Invalid PNG dimensions: ${file}`);
    console.log(`${file}: ${width}x${height}`);
  }
} finally {
  await context?.close();
  server.kill();
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once('exit', resolve),
  );
  await rm(profile, { recursive: true, force: true });
  await rm(extension, { recursive: true, force: true });
}
