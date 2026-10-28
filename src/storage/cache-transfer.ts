import type { CacheTransferEntry } from './cache-db';

export function validateImport(
  header: unknown,
  size: unknown,
  lines: unknown[],
): { entries: CacheTransferEntry[]; skipped: number } {
  if (
    typeof size !== 'number' ||
    !Number.isFinite(size) ||
    size < 0 ||
    size > 50 * 1024 * 1024 ||
    !header ||
    typeof header !== 'object' ||
    (header as { format?: unknown }).format !== 1 ||
    lines.length > 500
  )
    throw new Error('Invalid cache file');
  const entries: CacheTransferEntry[] = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      skipped++;
      continue;
    }
    const item = line as Record<string, unknown>;
    if (
      typeof item.key !== 'string' ||
      !/^[a-f0-9]{32}$/iu.test(item.key) ||
      typeof item.translated !== 'string' ||
      item.translated.length > 20_000 ||
      typeof item.createdAt !== 'number' ||
      !Number.isFinite(item.createdAt) ||
      (item.srcLang !== undefined && typeof item.srcLang !== 'string') ||
      (item.model !== undefined && typeof item.model !== 'string') ||
      (item.provider !== undefined && typeof item.provider !== 'string')
    ) {
      skipped++;
      continue;
    }
    entries.push({
      key: item.key.toLowerCase(),
      translated: item.translated,
      createdAt: item.createdAt,
      model: (item.model as string | undefined) ?? '',
      provider: (item.provider as string | undefined) ?? '',
      ...(item.srcLang === undefined
        ? {}
        : { srcLang: item.srcLang as string }),
    });
  }
  return { entries, skipped };
}
