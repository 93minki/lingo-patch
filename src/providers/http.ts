import { ProviderError } from './types';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function httpError(
  status: number,
  retryAfter: string | null = null,
): ProviderError {
  const kind =
    status === 401 || status === 403
      ? 'auth'
      : status === 429
        ? 'rate_limit'
        : status >= 500
          ? 'server'
          : 'bad_request';
  let retryAfterMs: number | undefined;
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay)) retryAfterMs = Math.max(0, delay);
  }
  return new ProviderError(kind, `Provider HTTP ${status}`, {
    status,
    retryAfterMs,
  });
}
export async function fetchJson(
  fetcher: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  try {
    if (init?.signal?.aborted) throw new ProviderError('aborted');
    const response = await fetcher(url, init);
    if (!response.ok)
      throw httpError(response.status, response.headers.get('retry-after'));
    try {
      return await response.json();
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ProviderError(
          'invalid_response',
          'Provider returned invalid JSON',
        );
      throw error;
    }
  } catch (error) {
    if (
      init?.signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw new ProviderError('aborted');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('network');
  }
}
export function modelIds(value: unknown, field = 'id'): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => isRecord(item) && typeof item[field] === 'string')
  )
    throw new ProviderError('invalid_response');
  return value.map((item) => item[field] as string);
}
