import { expect, test } from 'vitest';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_TTL_DAYS,
  TOUCH_INTERVAL_MS,
  estimateBytes,
  selectEvictions,
  shouldTouch,
} from '../../../src/core/cache/policy';

test('uses 90 days, 20 MiB, and daily touches', () => {
  expect(DEFAULT_TTL_DAYS).toBe(90);
  expect(DEFAULT_MAX_BYTES).toBe(20971520);
  expect(TOUCH_INTERVAL_MS).toBe(86400000);
  expect(shouldTouch(100, 100 + TOUCH_INTERVAL_MS - 1)).toBe(false);
  expect(shouldTouch(100, 100 + TOUCH_INTERVAL_MS)).toBe(true);
  expect(shouldTouch(100, 99)).toBe(false);
});
test('expires at the TTL boundary, never expires future timestamps', () => {
  expect(
    selectEvictions(
      [
        { key: 'old', lastAccess: 899, bytes: 10 },
        { key: 'boundary', lastAccess: 900, bytes: 10 },
        { key: 'fresh', lastAccess: 901, bytes: 10 },
        { key: 'future', lastAccess: 1001, bytes: 10 },
      ],
      1000,
      { ttlMs: 100, maxBytes: 100 },
    ),
  ).toEqual(['old', 'boundary']);
});
test('evicts oldest first down to 90 percent without mutating inputs', () => {
  const entries = [
    { key: 'new', lastAccess: 3, bytes: 85 },
    { key: 'middle', lastAccess: 2, bytes: 10 },
    { key: 'old', lastAccess: 1, bytes: 10 },
  ];
  expect(
    selectEvictions(entries, 1000, { ttlMs: 2000, maxBytes: 100 }),
  ).toEqual(['old', 'middle']);
  expect(entries.map((e) => e.key)).toEqual(['new', 'middle', 'old']);
});
test('TTL removals can satisfy capacity without extra LRU eviction', () => {
  expect(
    selectEvictions(
      [
        { key: 'old', lastAccess: 0, bytes: 100 },
        { key: 'fresh', lastAccess: 950, bytes: 95 },
      ],
      1000,
      { ttlMs: 100, maxBytes: 100 },
    ),
  ).toEqual(['old']);
});
test('does not evict at capacity, supports empty and zero limits', () => {
  expect(
    selectEvictions([{ key: 'ok', lastAccess: 1000, bytes: 100 }], 1000, {
      ttlMs: 100,
      maxBytes: 100,
    }),
  ).toEqual([]);
  expect(selectEvictions([], 0, { ttlMs: 0, maxBytes: 0 })).toEqual([]);
  expect(
    selectEvictions([{ key: 'all', lastAccess: 1000, bytes: 1 }], 1000, {
      ttlMs: 100,
      maxBytes: 0,
    }),
  ).toEqual(['all']);
});
test.each([
  { ttlMs: -1, maxBytes: 100 },
  { ttlMs: 100, maxBytes: NaN },
  { ttlMs: Infinity, maxBytes: 100 },
])('rejects invalid policy limits: %o', (opts) => {
  expect(() => selectEvictions([], 0, opts)).toThrow(RangeError);
});
test('estimates UTF-16 bytes including metadata overhead', () => {
  expect(estimateBytes('key', '한😀')).toBe(76);
});
