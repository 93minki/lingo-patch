import { browser } from 'wxt/browser';
import type { ProviderConfig, ProviderError } from '../providers/types';
import type { DisplayMode } from './types';

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
  error?: ProviderError['kind'] | 'unconfigured';
}
export type UiRequest =
  | { type: 'getTabStatus'; tabId: number }
  | { type: 'toggleTab'; tabId: number }
  | { type: 'retranslatePage'; tabId: number }
  | { type: 'validateProvider'; cfg: ProviderConfig }
  | { type: 'cacheUsage' }
  | { type: 'clearCache' }
  | { type: 'deleteSiteCache'; origin: string }
  | { type: 'openOptions' }
  | { type: 'setAutoSite'; tabId: number; enabled: boolean }
  | { type: 'setDisplayMode'; displayMode: DisplayMode };
export interface UiResponse {
  ok: boolean;
  error?: ProviderError['kind'] | 'permission' | 'unavailable';
  status?: TabStatus;
  models?: string[];
  usage?: { count: number; bytes: number };
}
export function uiRequest(request: UiRequest): Promise<UiResponse> {
  return browser.runtime.sendMessage({ scope: 'lp-ui', ...request });
}
