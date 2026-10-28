import { browser } from 'wxt/browser';
import { DEFAULT_GLOSSARY } from '../core/glossary/defaults';
import type { GlossaryEntry } from '../core/glossary/types';

export type Glossary = {
  global: GlossaryEntry[];
  sites: Record<string, GlossaryEntry[]>;
  useDefaults: boolean;
};
const key = 'lp-glossary';
export const emptyGlossary = (): Glossary => ({
  global: [],
  sites: {},
  useDefaults: true,
});
export function normalizeGlossary(raw: unknown): Glossary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return emptyGlossary();
  const value = raw as Record<string, unknown>;
  const entries = (items: unknown): GlossaryEntry[] =>
    Array.isArray(items)
      ? items.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const e = item as Record<string, unknown>;
          if (
            typeof e.term !== 'string' ||
            !e.term.trim() ||
            e.term.length > 200 ||
            (e.mode !== 'keep' && e.mode !== 'map') ||
            typeof e.caseSensitive !== 'boolean' ||
            (e.mode === 'map' &&
              (typeof e.target !== 'string' ||
                !e.target.trim() ||
                e.target.length > 200))
          )
            return [];
          return [
            {
              term: e.term.trim(),
              mode: e.mode,
              caseSensitive: e.caseSensitive,
              ...(e.mode === 'map' ? { target: e.target as string } : {}),
            } as GlossaryEntry,
          ];
        })
      : [];
  const sites: Record<string, GlossaryEntry[]> = {};
  if (
    value.sites &&
    typeof value.sites === 'object' &&
    !Array.isArray(value.sites)
  )
    for (const [host, list] of Object.entries(value.sites))
      if (/^[a-z0-9.-]+$/iu.test(host))
        sites[host.toLowerCase()] = entries(list);
  return {
    global: entries(value.global),
    sites,
    useDefaults: value.useDefaults !== false,
  };
}
export function effectiveGlossary(
  value: Glossary,
  hostname: string,
): GlossaryEntry[] {
  const result = new Map<string, GlossaryEntry>();
  for (const entry of [
    ...(value.useDefaults ? DEFAULT_GLOSSARY : []),
    ...value.global,
    ...(value.sites[hostname.toLowerCase()] ?? []),
  ])
    result.set(entry.term.toLowerCase(), entry);
  return [...result.values()];
}
export async function getGlossary(): Promise<Glossary> {
  return normalizeGlossary((await browser.storage.local.get(key))[key]);
}
export async function setGlossary(value: Glossary): Promise<void> {
  await browser.storage.local.set({ [key]: normalizeGlossary(value) });
}
export function onGlossaryChanged(listener: (value: Glossary) => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key])
      listener(normalizeGlossary(changes[key].newValue));
  });
}
