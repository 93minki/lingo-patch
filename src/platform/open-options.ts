import { browser } from 'wxt/browser';

export type OptionsSection =
  'engine' | 'glossary' | 'sites' | 'cache' | 'shortcuts';
export async function openOptionsTab(
  section: OptionsSection = 'engine',
): Promise<void> {
  const base = browser.runtime.getURL('/options.html');
  const url = `${base}#${section}`;
  const tabs = await browser.tabs.query({});
  const existing = tabs.find(
    (tab) =>
      tab.id !== undefined &&
      (tab.url === base ||
        tab.url?.startsWith(`${base}#`) ||
        tab.url?.startsWith(`${base}?`)),
  );
  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true, url });
    if (existing.windowId !== undefined)
      await browser.windows.update(existing.windowId, { focused: true });
  } else await browser.tabs.create({ url });
}
