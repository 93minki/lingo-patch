export const DEFAULT_TTL_DAYS = 90;
export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TTL_MS = DEFAULT_TTL_DAYS * DAY_MS;
export const TOUCH_INTERVAL_MS = DAY_MS;

export interface EntryMeta {
  key: string;
  lastAccess: number;
  bytes: number;
}

export function selectEvictions(
  entries: EntryMeta[],
  now: number,
  opts: { ttlMs: number; maxBytes: number },
): string[] {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(opts.ttlMs) ||
    opts.ttlMs < 0 ||
    !Number.isFinite(opts.maxBytes) ||
    opts.maxBytes < 0
  ) {
    throw new RangeError(
      'Cache time and limits must be finite and limits non-negative',
    );
  }
  const expired = entries.filter(
    (entry) => now - entry.lastAccess >= opts.ttlMs,
  );
  const remaining = entries.filter(
    (entry) => now - entry.lastAccess < opts.ttlMs,
  );
  const keys = expired.map((entry) => entry.key);
  let bytes = remaining.reduce((sum, entry) => sum + entry.bytes, 0);
  if (bytes > opts.maxBytes) {
    remaining.sort(
      (a, b) => a.lastAccess - b.lastAccess || a.key.localeCompare(b.key),
    );
    for (const entry of remaining) {
      if (bytes <= opts.maxBytes * 0.9) break;
      keys.push(entry.key);
      bytes -= entry.bytes;
    }
  }
  return keys;
}

export function estimateBytes(key: string, translated: string): number {
  return (key.length + translated.length) * 2 + 64;
}

export function shouldTouch(lastAccess: number, now: number): boolean {
  return now - lastAccess >= TOUCH_INTERVAL_MS;
}
