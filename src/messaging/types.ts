import type { TabStatus } from './extension';
import type { ProviderError } from '../providers/types';
import type { GlossaryEntry } from '../core/glossary/types';
export type DisplayMode = 'bilingual' | 'translation' | 'original';
export type PageContext = { pageTitle?: string; section?: string };
export type PageMessage = { generation: number } & (
  | { type: 'lookup'; keys: string[] }
  | {
      type: 'translate';
      items: { key: string; markup: string; priority: number }[];
      context?: PageContext;
    }
  | { type: 'page'; pageId: string; keys: string[]; prefetch?: boolean }
  | { type: 'reset'; stop?: boolean }
  | { type: 'openOptions' }
  | {
      type: 'status';
      enabled: boolean;
      total: number;
      restored: number;
      translated: number;
      pending: number;
      error?: ProviderError['kind'] | 'unconfigured';
    }
);
export type BackgroundMessage = { generation: number } & (
  | {
      type: 'cached';
      entries: { key: string; text: string }[];
      keys: string[];
      prefetch?: boolean;
    }
  | { type: 'translated'; key: string; text: string }
  | { type: 'failed'; key: string; kind: ProviderError['kind'] }
  | {
      type: 'mode';
      displayMode: DisplayMode;
      targetLang: string;
      autoEnabled: boolean;
      revision: number;
      configured: boolean;
      skipFixedBars: boolean;
      glossary?: GlossaryEntry[];
      hoverModifier?: 'alt' | 'control' | 'shift' | 'off';
      selectionTranslation?: boolean;
    }
  | { type: 'toggle' }
  | { type: 'retranslate' }
  | { type: 'inspect' }
  | { type: 'status'; status: TabStatus }
);
type WithoutGeneration<T> = T extends { generation: number }
  ? Omit<T, 'generation'>
  : never;
export type PagePayload = WithoutGeneration<PageMessage>;
export type BackgroundPayload = WithoutGeneration<BackgroundMessage>;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((key) => typeof key === 'string' && /^[a-f0-9]{32}$/u.test(key));
function context(value: unknown): boolean {
  return (
    value === undefined ||
    (record(value) &&
      (value.pageTitle === undefined || typeof value.pageTitle === 'string') &&
      (value.section === undefined || typeof value.section === 'string'))
  );
}
export function isPageMessage(value: unknown): value is PageMessage {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0
  )
    return false;
  switch (value.type) {
    case 'reset':
      return value.stop === undefined || typeof value.stop === 'boolean';
    case 'openOptions':
      return true;
    case 'status':
      return (
        typeof value.enabled === 'boolean' &&
        ['total', 'restored', 'translated', 'pending'].every(
          (key) =>
            Number.isSafeInteger(value[key]) && (value[key] as number) >= 0,
        ) &&
        (value.error === undefined ||
          [
            'auth',
            'rate_limit',
            'server',
            'network',
            'bad_request',
            'invalid_response',
            'aborted',
            'unconfigured',
          ].includes(value.error as string))
      );
    case 'lookup':
      return keys(value.keys);
    case 'page':
      return (
        typeof value.pageId === 'string' &&
        keys(value.keys) &&
        (value.prefetch === undefined || typeof value.prefetch === 'boolean')
      );
    case 'translate':
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            record(item) &&
            keys([item.key]) &&
            typeof item.markup === 'string' &&
            Number.isFinite(item.priority),
        ) &&
        context(value.context)
      );
    default:
      return false;
  }
}
