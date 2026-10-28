import { openDB, type DBSchema, type IDBPTransaction } from 'idb';
import {
  estimateBytes,
  selectEvictions,
  shouldTouch,
} from '../core/cache/policy';

export interface CachedSegment {
  translated: string;
  srcLang?: string;
  model: string;
  provider: string;
  createdAt: number;
  lastAccess: number;
  bytes: number;
}
export type CacheTransferEntry = {
  key: string;
  translated: string;
  srcLang?: string;
  model: string;
  provider: string;
  createdAt: number;
};

type WriteEntry = {
  key: string;
  value: Omit<CachedSegment, 'createdAt' | 'lastAccess' | 'bytes'>;
};
export interface CacheDb {
  getMany(keys: string[], now?: number): Promise<Map<string, CachedSegment>>;
  putMany(entries: WriteEntry[], now?: number): Promise<void>;
  getPage(pageId: string): Promise<string[] | undefined>;
  putPage(pageId: string, keys: string[], now?: number): Promise<void>;
  evict(
    now: number,
    opts: { ttlMs: number; maxBytes: number },
  ): Promise<{ deleted: number; bytesAfter: number }>;
  usage(): Promise<{ count: number; bytes: number }>;
  deleteMany(keys: string[]): Promise<void>;
  deleteSite(origin: string): Promise<number>;
  clear(): Promise<void>;
  close(): void;
  exportBatch(after?: string): Promise<CacheTransferEntry[]>;
  mergeBatch(
    entries: CacheTransferEntry[],
  ): Promise<{ imported: number; kept: number }>;
}

interface CacheSchema extends DBSchema {
  segments: {
    key: string;
    value: CachedSegment;
    indexes: { lastAccess: number };
  };
  pages: {
    key: string;
    value: { keys: string[]; updatedAt: number };
    indexes: { updatedAt: number };
  };
  meta: { key: string; value: unknown };
}
type Store = 'segments' | 'pages' | 'meta';

export async function openCacheDb(name = 'lingo-patch'): Promise<CacheDb> {
  const db = await openDB<CacheSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('segments').createIndex('lastAccess', 'lastAccess');
      db.createObjectStore('pages').createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('meta');
    },
    blocking() {
      db.close();
    },
  });

  async function transaction<T, Mode extends IDBTransactionMode>(
    stores: Store[],
    mode: Mode,
    run: (tx: IDBPTransaction<CacheSchema, Store[], Mode>) => Promise<T>,
  ): Promise<T> {
    const tx = db.transaction(stores, mode);
    try {
      const result = await run(tx);
      await tx.done;
      return result;
    } catch (error) {
      // Abort earlier writes too when a later request throws before reaching IndexedDB.
      try {
        tx.abort();
      } catch {
        /* Already completed or aborted. */
      }
      await tx.done.catch(() => {});
      throw error;
    }
  }

  return {
    exportBatch(after) {
      return transaction(['segments'], 'readonly', async (tx) => {
        const entries: CacheTransferEntry[] = [];
        for (
          let cursor = await tx
            .objectStore('segments')
            .openCursor(
              after ? IDBKeyRange.lowerBound(after, true) : undefined,
            );
          cursor && entries.length < 500;
          cursor = await cursor.continue()
        ) {
          const { translated, srcLang, model, provider, createdAt } =
            cursor.value;
          entries.push({
            key: cursor.key,
            translated,
            ...(srcLang === undefined ? {} : { srcLang }),
            model,
            provider,
            createdAt,
          });
        }
        return entries;
      });
    },
    mergeBatch(entries) {
      return transaction(['segments'], 'readwrite', async (tx) => {
        let imported = 0,
          kept = 0;
        const store = tx.objectStore('segments');
        for (const { key, ...value } of entries) {
          const old = await store.get(key);
          if (old && old.createdAt >= value.createdAt) {
            kept++;
            continue;
          }
          await store.put(
            {
              ...value,
              lastAccess: Date.now(),
              bytes: estimateBytes(key, value.translated),
            },
            key,
          );
          imported++;
        }
        return { imported, kept };
      });
    },
    getMany(keys, now = Date.now()) {
      return transaction(['segments'], 'readwrite', async (tx) => {
        const store = tx.objectStore('segments');
        const found = new Map<string, CachedSegment>();
        for (const key of new Set(keys)) {
          const value = await store.get(key);
          if (!value) continue;
          if (shouldTouch(value.lastAccess, now)) {
            value.lastAccess = now;
            await store.put(value, key);
          }
          found.set(key, value);
        }
        return found;
      });
    },
    putMany(entries, now = Date.now()) {
      return transaction(['segments'], 'readwrite', async (tx) => {
        for (const { key, value } of entries) {
          await tx.objectStore('segments').put(
            {
              ...value,
              createdAt: now,
              lastAccess: now,
              bytes: estimateBytes(key, value.translated),
            },
            key,
          );
        }
      });
    },
    async getPage(pageId) {
      return (await db.get('pages', pageId))?.keys;
    },
    putPage(pageId, keys, now = Date.now()) {
      return transaction(['pages'], 'readwrite', async (tx) => {
        await tx.objectStore('pages').put({ keys, updatedAt: now }, pageId);
      });
    },
    evict(now, opts) {
      return transaction(['segments', 'pages'], 'readwrite', async (tx) => {
        const store = tx.objectStore('segments');
        const entries = [];
        let bytesAfter = 0;
        for (
          let cursor = await store.index('lastAccess').openCursor();
          cursor;
          cursor = await cursor.continue()
        ) {
          const { lastAccess, bytes } = cursor.value;
          entries.push({ key: cursor.primaryKey, lastAccess, bytes });
          bytesAfter += bytes;
        }
        const keys = selectEvictions(entries, now, opts);
        const sizes = new Map(entries.map((entry) => [entry.key, entry.bytes]));
        for (const key of keys) {
          await store.delete(key);
          bytesAfter -= sizes.get(key)!;
        }
        for (
          let cursor = await tx
            .objectStore('pages')
            .index('updatedAt')
            .openCursor(IDBKeyRange.upperBound(now - opts.ttlMs));
          cursor;
          cursor = await cursor.continue()
        ) {
          await cursor.delete();
        }
        return { deleted: keys.length, bytesAfter };
      });
    },
    usage() {
      return transaction(['segments'], 'readonly', async (tx) => {
        let count = 0;
        let bytes = 0;
        for (
          let cursor = await tx.objectStore('segments').openCursor();
          cursor;
          cursor = await cursor.continue()
        ) {
          count++;
          bytes += cursor.value.bytes;
        }
        return { count, bytes };
      });
    },
    deleteMany(keys) {
      return transaction(['segments'], 'readwrite', async (tx) => {
        const store = tx.objectStore('segments');
        for (const key of new Set(keys)) await store.delete(key);
      });
    },
    deleteSite(origin) {
      const normalized = new URL(origin).origin;
      return transaction(['segments', 'pages'], 'readwrite', async (tx) => {
        const candidates = new Set<string>();
        const shared = new Set<string>();
        for (
          let cursor = await tx.objectStore('pages').openCursor();
          cursor;
          cursor = await cursor.continue()
        ) {
          if (
            cursor.key === normalized ||
            cursor.key.startsWith(`${normalized}/`)
          ) {
            for (const key of cursor.value.keys) candidates.add(key);
            await cursor.delete();
          } else for (const key of cursor.value.keys) shared.add(key);
        }
        let deleted = 0;
        const store = tx.objectStore('segments');
        for (const key of candidates) {
          if (!shared.has(key) && (await store.getKey(key)) !== undefined) {
            await store.delete(key);
            deleted++;
          }
        }
        return deleted;
      });
    },
    clear() {
      return transaction(
        ['segments', 'pages', 'meta'],
        'readwrite',
        async (tx) => {
          await Promise.all([
            tx.objectStore('segments').clear(),
            tx.objectStore('pages').clear(),
            tx.objectStore('meta').clear(),
          ]);
        },
      );
    },
    close() {
      db.close();
    },
  };
}
