import { browser } from 'wxt/browser';
import { providerOrigin } from './permissions';

const ALL_PAGE_ORIGINS = ['https://*/*', 'http://*/*'] as const;

export async function hasPageAccess(origin: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [`${origin}/*`] });
}

export async function hasProviderAccess(baseUrls: string[]): Promise<boolean> {
  if (baseUrls.length === 0) return true;
  const origins = baseUrls.map((baseUrl) => providerOrigin(baseUrl));
  return browser.permissions.contains({ origins });
}

export type RequestAccessInput = {
  pages?: 'all' | string;
  providers?: string[];
};

export async function requestAccess(input: RequestAccessInput): Promise<boolean> {
  const origins: string[] = [];
  if (input.pages === 'all') {
    origins.push(...ALL_PAGE_ORIGINS);
  } else if (input.pages) {
    origins.push(`${input.pages}/*`);
  }
  if (input.providers?.length) {
    for (const baseUrl of input.providers) {
      origins.push(providerOrigin(baseUrl));
    }
  }
  if (origins.length === 0) return true;
  return browser.permissions.request({ origins });
}

export async function requestProviderAccess(baseUrl: string): Promise<boolean> {
  return requestAccess({ providers: [baseUrl] });
}

export async function requestPageAccess(pages: 'all' | string): Promise<boolean> {
  return requestAccess({ pages });
}
