import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { DEFAULT_MAX_BYTES, DEFAULT_TTL_MS } from '../core/cache/policy';
import { openCacheDb } from '../storage/cache-db';

export default defineBackground(() => {
  const registerAlarm = async () => {
    if (!(await browser.alarms.get('lp-evict'))) {
      await browser.alarms.create('lp-evict', {
        delayInMinutes: 1440,
        periodInMinutes: 1440,
      });
    }
  };
  const schedule = () =>
    registerAlarm().catch((error) =>
      console.error('Failed to schedule cache eviction', error),
    );
  browser.runtime.onInstalled.addListener(() => {
    console.log('lingo-patch installed');
    return schedule();
  });
  browser.runtime.onStartup.addListener(schedule);
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'lp-evict') return;
    try {
      const db = await openCacheDb();
      try {
        await db.evict(Date.now(), {
          ttlMs: DEFAULT_TTL_MS,
          maxBytes: DEFAULT_MAX_BYTES,
        });
      } finally {
        db.close();
      }
    } catch (error) {
      console.error('Failed to evict cache', error);
    }
  });
});
