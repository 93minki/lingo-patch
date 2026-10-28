import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { DAY_MS } from '../core/cache/policy';
import { openCacheDb } from '../storage/cache-db';
import {
  getSettings,
  updateSettings,
  onSettingsChanged,
} from '../storage/settings';
import { createPageService } from '../messaging/service';

export default defineBackground(() => {
  const ready =
    import.meta.env.MODE === 'e2e'
      ? import('../testing/e2e-settings').then(({ bootstrapE2E }) =>
          bootstrapE2E(),
        )
      : Promise.resolve();
  let service: Promise<ReturnType<typeof createPageService>> | undefined;
  const getService = () =>
    (service ??= ready.then(async () =>
      createPageService(await openCacheDb(), await getSettings()),
    ));
  onSettingsChanged((settings) => {
    if (service)
      void service
        .then((current) => current.update(settings))
        .catch(() => console.error('Unable to update translation service'));
  });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'lp-page') return;
    let disconnected = false;
    port.onDisconnect.addListener(() => {
      disconnected = true;
    });
    void getService()
      .then((current) => {
        if (!disconnected) current.connect(port);
      })
      .catch(() => {
        try {
          port.disconnect();
        } catch {
          /* Already disconnected. */
        }
      });
  });
  browser.commands.onCommand.addListener(async (command) => {
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id === undefined) return;
      if (command === 'toggle-translate') {
        if (!(await getSettings()).provider)
          await browser.runtime.openOptionsPage();
        (await getService()).toggle(tab.id);
      } else if (command === 'cycle-mode') {
        const settings = await getSettings();
        const modes = ['bilingual', 'translation', 'original'] as const;
        await updateSettings({
          displayMode:
            modes[(modes.indexOf(settings.displayMode) + 1) % modes.length],
        });
      }
    } catch {
      console.error('Unable to execute translation command');
    }
  });
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
    return Promise.all([
      schedule(),
      ready.then(async () => {
        if (!(await getSettings()).provider)
          await browser.runtime.openOptionsPage();
      }),
    ]).catch(() => console.error('Unable to initialize extension'));
  });
  browser.runtime.onStartup.addListener(schedule);
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'lp-evict') return;
    try {
      const { cache } = await getSettings();
      const db = await openCacheDb();
      try {
        await db.evict(Date.now(), {
          ttlMs: cache.ttlDays * DAY_MS,
          maxBytes: cache.maxMB * 1024 * 1024,
        });
      } finally {
        db.close();
      }
    } catch (error) {
      console.error('Failed to evict cache', error);
    }
  });
});
