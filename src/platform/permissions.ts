import { requestAccess } from './host-access';

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
  // Called directly from a click handler to retain the user gesture.
  return requestAccess({ providers: [baseUrl] });
}
