import { browser } from 'wxt/browser';
import {
  filterUsage,
  localDate,
  recordUsage,
  type UsageCounts,
  type UsageData,
} from '../core/usage';

const KEY = 'lp-usage';
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = chain.then(work);
  chain = result.catch(() => {});
  return result;
}
export function getUsage(): Promise<UsageData> {
  return serial(async () => {
    const stored = await browser.storage.local.get(KEY);
    const data = (stored[KEY] ?? {}) as UsageData;
    const clean = filterUsage(data, new Date(), 90);
    if (Object.keys(clean).length !== Object.keys(data).length)
      await browser.storage.local.set({ [KEY]: clean });
    return clean;
  });
}
export function saveUsage(
  provider: string,
  model: string,
  counts: UsageCounts,
): Promise<void> {
  const date = new Date();
  return serial(async () => {
    const stored = await browser.storage.local.get(KEY);
    const data = filterUsage((stored[KEY] ?? {}) as UsageData, date, 90);
    await browser.storage.local.set({
      [KEY]: recordUsage(data, localDate(date), provider, model, counts),
    });
  });
}
export function clearUsage(): Promise<void> {
  return serial(() => browser.storage.local.remove(KEY));
}
