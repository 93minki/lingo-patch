import type { Browser } from 'wxt/browser';
import { TranslateQueue } from '../core/queue/translate-queue';
import { makeCacheKey } from '../core/cache/key';
import { PROMPT_VERSION } from '../core/prompt/version';
import { createProvider, ProviderError } from '../providers';
import type { CacheDb } from '../storage/cache-db';
import type { Settings } from '../storage/settings';
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
}
interface Task {
  promise: Promise<string>;
  saving: boolean;
}
export function createPageService(db: CacheDb, initial: Settings) {
  let settings = initial;
  let revision = 0;
  const connections = new Map<number, Connection>();
  let queue: TranslateQueue;
  let tasks = new Map<string, Task>();
  let contexts = new Map<string, PageContext | undefined>();
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
    });
  const configure = () => {
    const cfg = settings.provider;
    const selected = cfg ? createProvider(cfg) : undefined;
    const targetLang = settings.targetLang;
    const sourceContexts = (contexts = new Map());
    tasks = new Map();
    const preset = settings.preset
      ? PRESETS.find((item) => item.id === settings.preset)
      : undefined;
    queue = new TranslateQueue({
      ...(preset?.rpm ? { maxRequestsPerMinute: preset.rpm } : {}),
      translate: async (items, signal) => {
        if (!selected)
          throw new ProviderError('bad_request', 'Configure a provider first');
        return (
          await selected.translateBatch({
            items,
            signal,
            targetLang,
            glossary: [],
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
    if (message.type === 'reset') {
      if (message.generation < connection.generation) return;
      connection.generation = message.generation;
      queue.cancelTab(connection.tabId);
      return;
    }
    if (message.generation !== connection.generation) return;
    const generation = message.generation;
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
      await db.putPage(message.pageId, message.keys);
      return;
    }
    const currentQueue = queue;
    const currentTasks = tasks;
    const currentProvider = settings.provider;
    const currentContexts = contexts;
    const targetLang = settings.targetLang;
    for (const item of message.items) {
      void (async () => {
        try {
          if (
            (await makeCacheKey({
              markup: item.markup,
              targetLang,
              promptVersion: PROMPT_VERSION,
            })) !== item.key
          )
            throw new ProviderError('bad_request');
          const cached = await db.getMany([item.key]);
          if (connection.generation !== generation || queue !== currentQueue)
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
          connections.delete(tabId);
          queue.cancelTab(tabId);
        }
      });
      mode(connection);
    },
    update(next: Settings) {
      const changed =
        JSON.stringify([
          settings.provider,
          settings.preset,
          settings.targetLang,
        ]) !== JSON.stringify([next.provider, next.preset, next.targetLang]);
      settings = next;
      if (changed) {
        for (const tabId of connections.keys()) queue.cancelTab(tabId);
        revision++;
        configure();
      }
      for (const connection of connections.values()) mode(connection);
    },
    toggle(tabId: number) {
      const connection = connections.get(tabId);
      if (connection) send(connection, { type: 'toggle' });
    },
    close() {
      for (const tabId of connections.keys()) queue.cancelTab(tabId);
      connections.clear();
      db.close();
    },
  };
}
