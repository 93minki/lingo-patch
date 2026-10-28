import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { deserialize } from '../../../src/core/segment';
import { validateImport } from '../../../src/storage/cache-transfer';
import { openCacheDb, type CacheDb } from '../../../src/storage/cache-db';

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const header = { format: 1, promptVersion: 1, exportedAt: 1, count: 1 };

const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const KEY_C = 'cccccccccccccccccccccccccccccccc';

function entry(
  key: string,
  translated: string,
  createdAt: number,
): {
  key: string;
  translated: string;
  model: string;
  provider: string;
  createdAt: number;
} {
  return {
    key,
    translated,
    model: 'test-model',
    provider: 'test-provider',
    createdAt,
  };
}

function segmentValue(translated: string) {
  return {
    translated,
    model: 'test-model',
    provider: 'test-provider',
    srcLang: 'en',
  };
}

let cache: CacheDb;
let dbName: string;

beforeEach(async () => {
  dbName = `cache-transfer-${crypto.randomUUID()}`;
  cache = await openCacheDb(dbName);
});

afterEach(async () => {
  cache.close();
  await deleteDB(dbName);
});

describe('validateImport', () => {
  test('rejects invalid headers and oversize payloads', () => {
    expect(() => validateImport({ format: 2 }, 10, [])).toThrowError(
      /Invalid cache file/u,
    );
    expect(() => validateImport(null, 10, [])).toThrowError(
      /Invalid cache file/u,
    );
    expect(() => validateImport(header, MAX_IMPORT_BYTES + 1, [])).toThrowError(
      /Invalid cache file/u,
    );
    expect(() => validateImport(header, -1, [])).toThrowError(
      /Invalid cache file/u,
    );
  });

  test('rejects batches larger than 500 lines', () => {
    const lines = Array.from({ length: 501 }, () => null);
    expect(() => validateImport(header, 100, lines)).toThrowError(
      /Invalid cache file/u,
    );
  });

  test('skips null and malformed lines while accepting valid entries', () => {
    const { entries, skipped } = validateImport(header, 100, [
      null,
      { key: 'not-hex', translated: 'x', createdAt: 1 },
      {
        key: KEY_A,
        translated: 'ok',
        createdAt: 10,
        model: 'm',
        provider: 'p',
      },
      [],
      {
        key: KEY_B,
        translated: 'x'.repeat(20_001),
        createdAt: 2,
      },
    ]);
    expect(skipped).toBe(4);
    expect(entries).toEqual([
      {
        key: KEY_A,
        translated: 'ok',
        createdAt: 10,
        model: 'm',
        provider: 'p',
      },
    ]);
  });

  test('normalizes hex keys to lowercase', () => {
    const upper = KEY_A.toUpperCase();
    const { entries } = validateImport(header, 50, [
      { key: upper, translated: 'text', createdAt: 1 },
    ]);
    expect(entries[0]?.key).toBe(KEY_A);
  });
});

describe('export, clear, and mergeBatch', () => {
  test('exports all entries when below batch limit, clears, and restores via mergeBatch', async () => {
    await cache.putMany(
      [
        { key: KEY_A, value: segmentValue('alpha') },
        { key: KEY_B, value: segmentValue('beta') },
        { key: KEY_C, value: segmentValue('gamma') },
      ],
      100,
    );

    const exported = await cache.exportBatch();
    expect(exported).toHaveLength(3);
    expect(exported.map((item) => item.key)).toEqual([KEY_A, KEY_B, KEY_C]);

    await cache.clear();
    expect(await cache.usage()).toEqual({ count: 0, bytes: 0 });

    const { entries, skipped } = validateImport(header, 100, exported);
    expect(skipped).toBe(0);
    expect(await cache.mergeBatch(entries)).toEqual({ imported: 3, kept: 0 });

    const restored = await cache.getMany([KEY_A, KEY_B, KEY_C], 200);
    expect(restored.get(KEY_A)?.translated).toBe('alpha');
    expect(restored.get(KEY_B)?.translated).toBe('beta');
    expect(restored.get(KEY_C)?.translated).toBe('gamma');
  });

  test('exportBatch paginates with after cursor at 500 entries', async () => {
    const keys = Array.from({ length: 501 }, (_, index) =>
      index.toString(16).padStart(32, '0'),
    );
    await cache.putMany(
      keys.map((key) => ({ key, value: segmentValue(key.slice(0, 4)) })),
      1,
    );
    const first = await cache.exportBatch();
    expect(first).toHaveLength(500);
    const second = await cache.exportBatch(first[499]!.key);
    expect(second).toHaveLength(1);
    expect(second[0]?.key).toBe(keys[500]);
  });

  test('keeps existing segment when imported createdAt is older', async () => {
    await cache.putMany([{ key: KEY_A, value: segmentValue('stored') }], 200);
    const result = await cache.mergeBatch([entry(KEY_A, 'imported-old', 100)]);
    expect(result).toEqual({ imported: 0, kept: 1 });
    expect((await cache.getMany([KEY_A], 300)).get(KEY_A)?.translated).toBe(
      'stored',
    );
  });

  test('replaces segment when imported createdAt is newer', async () => {
    await cache.putMany([{ key: KEY_A, value: segmentValue('stored') }], 100);
    const result = await cache.mergeBatch([entry(KEY_A, 'imported-new', 500)]);
    expect(result).toEqual({ imported: 1, kept: 0 });
    expect((await cache.getMany([KEY_A], 600)).get(KEY_A)?.translated).toBe(
      'imported-new',
    );
  });
});

describe('imported translation rendering safety', () => {
  test('deserialize treats malicious HTML in translated text as plain text', () => {
    const malicious = '<img src=x onerror="alert(1)"><script>bad()</script>';
    const { entries } = validateImport(header, malicious.length, [
      entry(KEY_A, malicious, 1),
    ]);
    expect(entries).toHaveLength(1);

    const { fragment, fallback } = deserialize(
      entries[0]!.translated,
      [],
      document,
    );
    expect(fragment.querySelector('img')).toBeNull();
    expect(fragment.querySelector('script')).toBeNull();
    expect(fragment.textContent).toContain('<img');
    expect(fragment.textContent).toContain('<script>');
    expect(fallback).toBe(true);
  });

  test('round-trip export payload survives validateImport', async () => {
    await cache.putMany(
      [{ key: KEY_A, value: segmentValue('safe &amp; text') }],
      50,
    );
    const exported = await cache.exportBatch();
    const { entries, skipped } = validateImport(header, 128, exported);
    expect(skipped).toBe(0);
    expect(entries[0]?.translated).toBe('safe &amp; text');
    const rendered = deserialize(entries[0]!.translated, [], document);
    expect(rendered.fragment.textContent).toBe('safe & text');
  });
});
