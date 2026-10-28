const MAX_ENTRIES = 5000;

export type MarkupKeyCache = {
  get: (markup: string) => Promise<string>;
  clear: () => void;
};

export function createMarkupKeyCache(
  compute: (markup: string) => Promise<string>,
): MarkupKeyCache {
  const cache = new Map<string, string>();
  return {
    get(markup: string) {
      const hit = cache.get(markup);
      if (hit !== undefined) return Promise.resolve(hit);
      return compute(markup).then((key) => {
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(markup, key);
        return key;
      });
    },
    clear() {
      cache.clear();
    },
  };
}
