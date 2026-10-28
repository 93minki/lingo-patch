import { browser } from 'wxt/browser';

export function providerOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid provider URL');
  return `${url.protocol}//${url.hostname.includes(':') ? `[${url.hostname.replace(/^\[|\]$/gu, '')}]` : url.hostname}/*`;
}
export async function requestProviderPermission(
  baseUrl: string,
): Promise<boolean> {
  const origins = [providerOrigin(baseUrl)];
  // Called directly from the options click handler to retain the user gesture.
  return browser.permissions.request({ origins });
}
