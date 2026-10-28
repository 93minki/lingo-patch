import type { Browser } from 'wxt/browser';
import { TranslateQueue } from '../core/queue/translate-queue';
import { makeCacheKey, matchingGlossary } from '../core/cache/key';
import {
  emptyGlossary,
  effectiveGlossary,
  type Glossary,
} from '../storage/glossary';
import type { GlossaryEntry } from '../core/glossary/types';
import { validateImport } from '../storage/cache-transfer';
import { DAY_MS } from '../core/cache/policy';
import { PROMPT_VERSION } from '../core/prompt/version';
import { createProvider, ProviderError } from '../providers';
import type { CacheDb } from '../storage/cache-db';
import type { TabStatus } from './extension';
import type { Settings } from '../storage/settings';
import type { ProviderConfig } from '../providers/types';
import {
  isPageMessage,
  type BackgroundPayload,
  type PageContext,
  type PageMessage,
} from './types';
import { PRESETS } from '../providers/presets';

interface Connection {
  port: Browser.runtime.Port;
  tabId: number;
  generation: number;
  origin: string;
  hostname: string;
  keys: string[];
  inspected?: () => void;
  inspection?: Promise<void>;
  stats: Pick<
    TabStatus,
    'enabled' | 'total' | 'restored' | 'translated' | 'pending' | 'error'
  >;
}
interface Task {
  promise: Promise<string>;
  saving: boolean;
}
export function createPageService(
  db: CacheDb,
  initial: Settings,
  onStatus?: (tabId: number, status?: TabStatus) => void,
  initialGlossary: Glossary = { ...emptyGlossary(), useDefaults: false },
  initialProvider: ProviderConfig | null = null,
) {
  let settings = initial;
  let providerConfig = initialProvider;
  let glossary = initialGlossary;
  let revision = 0;
  const connections = new Map<number, Connection>();
  let queue: TranslateQueue;
  let tasks = new Map<string, Task>();
  let contexts = new Map<string, PageContext | undefined>();
  let glossaries = new Map<string, GlossaryEntry[]>();
  const send = (connection: Connection, message: BackgroundPayload) => {
    if (connections.get(connection.tabId) !== connection) return;
    try {
      connection.port.postMessage({
        ...message,
        generation: connection.generation,
      });
    } catch {
      /* Disconnected before delivery. */
    }
  };
  const mode = (connection: Connection) =>
    send(connection, {
      type: 'mode',
      displayMode: settings.displayMode,
      targetLang: settings.targetLang,
      autoEnabled: settings.autoSites.includes(connection.hostname),
      revision,
      configured: Boolean(providerConfig),
      skipFixedBars: settings.skipFixedBars,
      glossary: effectiveGlossary(glossary, connection.hostname),
      hoverModifier: settings.hoverModifier ?? 'alt',
      selectionTranslation: settings.selectionTranslation ?? true,
    });
  const status = (connection: Connection): TabStatus => ({
    ...connection.stats,
    available: true,
    configured: Boolean(providerConfig),
    hostname: connection.hostname,
    origin: connection.origin,
    autoEnabled: settings.autoSites.includes(connection.hostname),
    displayMode: settings.displayMode,
  });
  const configure = () => {
    const cfg = providerConfig;
    const selected = cfg ? createProvider(cfg) : undefined;
    const targetLang = settings.targetLang;
    const sourceContexts = (contexts = new Map());
    const batchGlossaries = (glossaries = new Map());
    tasks = new Map();
    const preset = settings.preset
      ? PRESETS.find((item) => item.id === settings.preset)
      : undefined;
    queue = new TranslateQueue({
      ...(preset?.rpm ? { maxRequestsPerMinute: preset.rpm } : {}),
      groupKey: (item) => JSON.stringify(batchGlossaries.get(item.key) ?? []),
      translate: async (items, signal, keys) => {
        if (!selected)
          throw new ProviderError('bad_request', 'Configure a provider first');
        return (
          await selected.translateBatch({
            items,
            signal,
            targetLang,
            glossary: batchGlossaries.get(keys[0]!) ?? [],
            context: sourceContexts.get(items[0]?.text ?? ''),
          })
        ).items;
      },
    });
  };
  configure();
  const lookup = async (
    connection: Connection,
    keys: string[],
    generation: number,
    prefetch = false,
  ) => {
    const found = await db.getMany(keys);
    if (connection.generation !== generation) return;
    send(connection, {
      type: 'cached',
      keys,
      entries: [...found].map(([key, value]) => ({
        key,
        text: value.translated,
      })),
      prefetch,
    });
  };
  const handle = async (connection: Connection, message: PageMessage) => {
    if (message.type === 'openOptions') return;
    if (message.type === 'reset') {
      if (message.generation < connection.generation) return;
      connection.generation = message.generation;
      queue.cancelTab(connection.tabId, message.stop === true);
      connection.stats = {
        enabled: false,
        total: 0,
        restored: 0,
        translated: 0,
        pending: 0,
      };
      onStatus?.(connection.tabId, status(connection));
      return;
    }
    if (message.generation !== connection.generation) return;
    const generation = message.generation;
    if (message.type === 'status') {
      const { enabled, total, restored, translated, pending, error } = message;
      connection.stats = {
        enabled,
        total,
        restored,
        translated,
        pending,
        error,
      };
      onStatus?.(connection.tabId, status(connection));
      return;
    }
    if (message.type === 'lookup')
      return lookup(connection, message.keys, generation);
    if (message.type === 'page') {
      if (new URL(message.pageId).origin !== connection.origin)
        throw new ProviderError('bad_request');
      if (message.prefetch)
        return lookup(
          connection,
          (await db.getPage(message.pageId)) ?? [],
          generation,
          true,
        );
      connection.keys = message.keys;
      await db.putPage(message.pageId, message.keys);
      connection.inspected?.();
      return;
    }
    const currentQueue = queue;
    const currentTasks = tasks;
    const currentProvider = providerConfig;
    const currentContexts = contexts;
    const currentGlossaries = glossaries;
    const siteGlossary = effectiveGlossary(glossary, connection.hostname);
    const targetLang = settings.targetLang;
    for (const item of message.items) {
      void (async () => {
        try {
          if (
            (await makeCacheKey({
              markup: item.markup,
              targetLang,
              promptVersion: PROMPT_VERSION,
              glossary: siteGlossary,
            })) !== item.key
          )
            throw new ProviderError('bad_request');
          const cached = await db.getMany([item.key]);
          if (
            connections.get(connection.tabId) !== connection ||
            connection.generation !== generation ||
            queue !== currentQueue
          )
            return;
          if (cached.has(item.key)) {
            send(connection, {
              type: 'translated',
              key: item.key,
              text: cached.get(item.key)!.translated,
            });
            return;
          }
          let task = currentTasks.get(item.key);
          if (!task) {
            currentContexts.set(item.markup, message.context);
            currentGlossaries.set(
              item.key,
              matchingGlossary(item.markup, siteGlossary),
            );
            const translation = currentQueue.enqueue({
              ...item,
              tabId: connection.tabId,
            });
            task = { saving: false, promise: Promise.resolve('') };
            const tracked = task;
            task.promise = translation
              .then(async (text) => {
                tracked.saving = true;
                if (!currentProvider) throw new ProviderError('bad_request');
                await db.putMany([
                  {
                    key: item.key,
                    value: {
                      translated: text,
                      model: currentProvider.model,
                      provider: currentProvider.provider,
                    },
                  },
                ]);
                return text;
              })
              .finally(() => {
                currentContexts.delete(item.markup);
                currentGlossaries.delete(item.key);
                if (currentTasks.get(item.key) === tracked)
                  currentTasks.delete(item.key);
              });
            currentTasks.set(item.key, task);
          } else if (!task.saving) {
            void currentQueue
              .enqueue({ ...item, tabId: connection.tabId })
              .catch(() => {});
          }
          const text = await task.promise;
          if (connection.generation === generation && queue === currentQueue)
            send(connection, {
              type: 'translated',
              key: item.key,
              text,
            });
        } catch (error) {
          if (connection.generation === generation && queue === currentQueue)
            send(connection, {
              type: 'failed',
              key: item.key,
              kind: error instanceof ProviderError ? error.kind : 'network',
            });
        }
      })();
    }
  };
  return {
    updateGlossary(next: Glossary) {
      glossary = next;
      for (const connection of connections.values()) mode(connection);
    },
    connect(port: Browser.runtime.Port) {
      const tabId = port.sender?.tab?.id;
      const url = port.sender?.url ?? port.sender?.tab?.url;
      if (
        port.name !== 'lp-page' ||
        tabId === undefined ||
        !url ||
        (port.sender?.frameId && port.sender.frameId !== 0)
      ) {
        port.disconnect();
        return;
      }
      const address = new URL(url);
      queue.cancelTab(tabId);
      const connection: Connection = {
        port,
        tabId,
        generation: 0,
        origin: address.origin,
        hostname: address.hostname,
        keys: [],
        stats: {
          enabled: false,
          total: 0,
          restored: 0,
          translated: 0,
          pending: 0,
        },
      };
      connections.set(tabId, connection);
      port.onMessage.addListener((message: unknown) => {
        if (connections.get(tabId) !== connection || !isPageMessage(message))
          return;
        void handle(connection, message).catch(() => {
          /* Invalid messages do not expose service details. */
        });
      });
      port.onDisconnect.addListener(() => {
        if (connections.get(tabId) === connection) {
          connection.inspected?.();
          connections.delete(tabId);
          queue.cancelTab(tabId);
          onStatus?.(tabId);
        }
      });
      mode(connection);
    },
    configured: () => Boolean(providerConfig),
    invalidateSecrets(ids: string[]) {
      const id = settings.preset ?? settings.provider?.provider;
      if (id && providerConfig && ids.includes(id)) this.update(settings, null);
    },
    update(next: Settings, nextProvider: ProviderConfig | null = null) {
      const changed =
        JSON.stringify([
          providerConfig,
          settings.preset,
          settings.targetLang,
        ]) !== JSON.stringify([nextProvider, next.preset, next.targetLang]);
      settings = next;
      providerConfig = nextProvider;
      if (changed) {
        queue.abortAll();
        revision++;
        configure();
      }
      for (const connection of connections.values()) {
        mode(connection);
        onStatus?.(connection.tabId, status(connection));
      }
    },
    async inspect(tabId: number) {
      const connection = connections.get(tabId);
      if (!connection) return;
      if (!connection.inspection) {
        connection.inspection = new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            connection.inspected = undefined;
            connection.inspection = undefined;
            resolve();
          };
          const timer = setTimeout(done, 1500);
          connection.inspected = done;
          send(connection, { type: 'inspect' });
        });
      }
      await connection.inspection;
    },
    status(tabId: number) {
      const connection = connections.get(tabId);
      return connection ? status(connection) : undefined;
    },
    async retranslate(tabId: number) {
      const connection = connections.get(tabId);
      if (!connection) throw new ProviderError('bad_request');
      const generation = connection.generation;
      const current = () =>
        connections.get(tabId) === connection &&
        connection.generation === generation;
      await this.inspect(tabId);
      if (!current()) throw new ProviderError('aborted');
      const keys = [...connection.keys];
      await Promise.allSettled(
        keys.flatMap((key) => tasks.get(key)?.promise ?? []),
      );
      if (!current()) throw new ProviderError('aborted');
      await db.deleteMany(keys);
      if (!current()) throw new ProviderError('aborted');
      send(connection, { type: 'retranslate' });
    },
    cacheUsage: () => db.usage(),
    cacheExportBatch: (after?: string) => db.exportBatch(after),
    async cacheImportBatch(
      header: unknown,
      size: unknown,
      lines: unknown[],
      finish = false,
    ) {
      const { entries, skipped } = validateImport(header, size, lines);
      const result = await db.mergeBatch(entries);
      if (finish)
        await db.evict(Date.now(), {
          ttlMs: settings.cache.ttlDays * DAY_MS,
          maxBytes: settings.cache.maxMB * 1024 * 1024,
        });
      return { ...result, skipped };
    },
    clearCache: () => db.clear(),
    deleteSiteCache: (origin: string) => db.deleteSite(origin),
    toggle(tabId: number) {
      const connection = connections.get(tabId);
      if (connection) send(connection, { type: 'toggle' });
    },
    close() {
      queue.abortAll();
      connections.clear();
      db.close();
    },
  };
}
