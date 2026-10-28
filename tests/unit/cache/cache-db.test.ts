import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { openCacheDb, type CacheDb } from '../../../src/storage/cache-db';
import {
  estimateBytes,
  TOUCH_INTERVAL_MS,
} from '../../../src/core/cache/policy';

let cache: CacheDb;
let name: string;
const value = (translated = '번역문') => ({
  translated,
  model: 'model',
  provider: 'test',
  srcLang: 'en',
});
beforeEach(async () => {
  name = `cache-test-${crypto.randomUUID()}`;
  cache = await openCacheDb(name);
});
afterEach(async () => {
  cache.close();
  await deleteDB(name);
});

test('creates version 1 stores and indexes', async () => {
  const raw = await openDB(name);
  try {
    expect(raw.version).toBe(1);
    expect(Array.from(raw.objectStoreNames)).toEqual([
      'meta',
      'pages',
      'segments',
    ]);
    const tx = raw.transaction(['segments', 'pages']);
    expect(Array.from(tx.objectStore('segments').indexNames)).toEqual([
      'lastAccess',
    ]);
    expect(Array.from(tx.objectStore('pages').indexNames)).toEqual([
      'updatedAt',
    ]);
    await tx.done;
  } finally {
    raw.close();
  }
});
test('round trips entries, omits missing keys, and persists across connections', async () => {
  await cache.putMany([{ key: 'a', value: value() }], 100);
  cache.close();
  cache = await openCacheDb(name);
  const found = await cache.getMany(['a', 'missing', 'a'], 101);
  expect(found.size).toBe(1);
  expect(found.get('a')).toEqual({
    ...value(),
    createdAt: 100,
    lastAccess: 100,
    bytes: estimateBytes('a', '번역문'),
  });
  expect(await cache.getMany([], 101)).toEqual(new Map());
});
test('touches only once per day, returns and persists updated lastAccess', async () => {
  await cache.putMany([{ key: 'a', value: value() }], 100);
  expect(
    (await cache.getMany(['a'], 100 + TOUCH_INTERVAL_MS - 1)).get('a')!
      .lastAccess,
  ).toBe(100);
  expect(
    (await cache.getMany(['a'], 100 + TOUCH_INTERVAL_MS)).get('a')!.lastAccess,
  ).toBe(100 + TOUCH_INTERVAL_MS);
  expect(
    (await cache.getMany(['a'], 100 + TOUCH_INTERVAL_MS + 1)).get('a')!
      .lastAccess,
  ).toBe(100 + TOUCH_INTERVAL_MS);
});
test('usage sums stored entries and overwrite replaces size and translation time', async () => {
  await cache.putMany(
    [
      { key: 'a', value: value('A') },
      { key: 'b', value: value('BB') },
    ],
    100,
  );
  expect(await cache.usage()).toEqual({
    count: 2,
    bytes: estimateBytes('a', 'A') + estimateBytes('b', 'BB'),
  });
  await cache.putMany([{ key: 'a', value: value('longer') }], 200);
  expect((await cache.getMany(['a'], 200)).get('a')).toMatchObject({
    translated: 'longer',
    createdAt: 200,
    lastAccess: 200,
  });
  expect(await cache.usage()).toEqual({
    count: 2,
    bytes: estimateBytes('a', 'longer') + estimateBytes('b', 'BB'),
  });
});
test('round trips page references including empty and missing pages', async () => {
  expect(await cache.getPage('https://site.test/missing')).toBeUndefined();
  await cache.putPage('https://site.test/docs', ['a', 'b'], 100);
  await cache.putPage('https://site.test/empty', [], 100);
  expect(await cache.getPage('https://site.test/docs')).toEqual(['a', 'b']);
  expect(await cache.getPage('https://site.test/empty')).toEqual([]);
});
test('evicts TTL entries and old pages at equality while preserving recent pages', async () => {
  await cache.putMany([{ key: 'old', value: value() }], 900);
  await cache.putMany([{ key: 'fresh', value: value() }], 901);
  await cache.putPage('https://site.test/old', ['old'], 900);
  await cache.putPage('https://site.test/new', ['fresh'], 901);
  expect(await cache.evict(1000, { ttlMs: 100, maxBytes: 10000 })).toEqual({
    deleted: 1,
    bytesAfter: estimateBytes('fresh', '번역문'),
  });
  expect(await cache.getPage('https://site.test/old')).toBeUndefined();
  expect(await cache.getPage('https://site.test/new')).toEqual(['fresh']);
  expect((await cache.getMany(['old', 'fresh'], 1000)).size).toBe(1);
});
test('evicts by LRU to 90 percent and reports actual usage', async () => {
  await cache.putMany([{ key: 'a', value: value('A') }], 1);
  await cache.putMany([{ key: 'b', value: value('B') }], 2);
  await cache.putMany([{ key: 'c', value: value('C') }], 3);
  expect(await cache.evict(100, { ttlMs: 1000, maxBytes: 150 })).toEqual({
    deleted: 2,
    bytesAfter: 68,
  });
  expect(await cache.usage()).toEqual({ count: 1, bytes: 68 });
  expect(
    [...(await cache.getMany(['a', 'b', 'c'], 100))].map(([key]) => key),
  ).toEqual(['c']);
});
test('deleteSite preserves cross-origin shared keys, unrelated keys and other pages', async () => {
  await cache.putMany(
    ['only', 'shared', 'other', 'orphan'].map((key) => ({
      key,
      value: value(),
    })),
    100,
  );
  await cache.putPage(
    'https://site.test/a',
    ['only', 'shared', 'missing'],
    100,
  );
  await cache.putPage('https://site.test/b', ['only'], 100);
  await cache.putPage('https://site.test.evil/a', ['shared', 'other'], 100);
  expect(await cache.deleteSite('https://site.test')).toBe(1);
  expect(await cache.getPage('https://site.test/a')).toBeUndefined();
  expect(await cache.getPage('https://site.test/b')).toBeUndefined();
  expect(await cache.getPage('https://site.test.evil/a')).toEqual([
    'shared',
    'other',
  ]);
  expect([
    ...(await cache.getMany(['only', 'shared', 'other', 'orphan'], 100)).keys(),
  ]).toEqual(['shared', 'other', 'orphan']);
  expect(await cache.deleteSite('https://site.test')).toBe(0);
});
test('clear removes all stores including meta', async () => {
  await cache.putMany([{ key: 'a', value: value() }], 100);
  await cache.putPage('https://site.test/a', ['a'], 100);
  const raw = await openDB(name);
  try {
    await raw.put('meta', { count: 999 }, 'stats');
    await cache.clear();
    expect(await cache.usage()).toEqual({ count: 0, bytes: 0 });
    expect(await cache.getPage('https://site.test/a')).toBeUndefined();
    expect(await raw.count('meta')).toBe(0);
  } finally {
    raw.close();
  }
});
test('aborts entire batch on cloning failure instead of committing earlier writes', async () => {
  const invalid = { ...value(), model: (() => {}) as unknown as string };
  await expect(
    cache.putMany(
      [
        { key: 'first', value: value() },
        { key: 'bad', value: invalid },
      ],
      100,
    ),
  ).rejects.toThrow();
  expect(await cache.usage()).toEqual({ count: 0, bytes: 0 });
});
test('deleteMany removes only selected segment keys and ignores missing keys', async () => {
  await cache.putMany(
    [
      { key: 'a', value: value('A') },
      { key: 'b', value: value('B') },
      { key: 'c', value: value('C') },
    ],
    100,
  );
  await cache.deleteMany(['a', 'missing', 'c', 'a']);
  expect([...(await cache.getMany(['a', 'b', 'c'], 100)).keys()]).toEqual([
    'b',
  ]);
  expect(await cache.usage()).toEqual({
    count: 1,
    bytes: estimateBytes('b', 'B'),
  });
});
test('deleteMany leaves page acceleration references unchanged for shared keys', async () => {
  await cache.putMany(
    [
      { key: 'shared', value: value('shared') },
      { key: 'solo', value: value('solo') },
    ],
    100,
  );
  await cache.putPage('https://site.test/a', ['shared', 'solo'], 100);
  await cache.putPage('https://site.test/b', ['shared'], 100);
  await cache.deleteMany(['shared']);
  expect(await cache.getPage('https://site.test/a')).toEqual(['shared', 'solo']);
  expect(await cache.getPage('https://site.test/b')).toEqual(['shared']);
  expect([...(await cache.getMany(['shared', 'solo'], 100)).keys()]).toEqual([
    'solo',
  ]);
  expect(await cache.usage()).toEqual({
    count: 1,
    bytes: estimateBytes('solo', 'solo'),
  });
});
