import { browser } from 'wxt/browser';
import type { ProviderConfig, ProviderError } from '../providers/types';
import type { DisplayMode } from './types';
import type { UsageCounts, UsageData } from '../core/usage';
import type { CacheTransferEntry } from '../storage/cache-db';

export interface TabStatus {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  hostname: string;
  origin: string;
  displayMode: DisplayMode;
  autoEnabled: boolean;
  total: number;
  restored: number;
  translated: number;
  pending: number;
  pageUsage?: UsageCounts;
  error?: ProviderError['kind'] | 'unconfigured';
}
export type UiRequest =
  | { type: 'getTabStatus'; tabId: number }
  | { type: 'toggleTab'; tabId: number }
  | { type: 'retranslatePage'; tabId: number }
  | { type: 'validateProvider'; cfg: ProviderConfig }
  | { type: 'getUsage' }
  | { type: 'clearUsage' }
  | { type: 'cacheUsage' }
  | { type: 'clearCache' }
  | { type: 'deleteSiteCache'; origin: string }
  | { type: 'openOptions' }
  | { type: 'setAutoSite'; tabId: number; enabled: boolean }
  | { type: 'setDisplayMode'; displayMode: DisplayMode }
  | { type: 'cacheExportBatch'; after?: string }
  | {
      type: 'cacheImportBatch';
      header: unknown;
      size: number;
      lines: unknown[];
      finish?: boolean;
    };
export interface UiResponse {
  ok: boolean;
  error?: ProviderError['kind'] | 'permission' | 'unavailable';
  status?: TabStatus;
  models?: string[];
  tokenUsage?: UsageData;
  usage?: { count: number; bytes: number };
  entries?: CacheTransferEntry[];
  importResult?: { imported: number; skipped: number; kept: number };
}
export function uiRequest(request: UiRequest): Promise<UiResponse> {
  return browser.runtime.sendMessage({ scope: 'lp-ui', ...request });
}
