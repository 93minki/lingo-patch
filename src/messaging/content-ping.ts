export const CONTENT_PING = { scope: 'lp-content', type: 'ping' } as const;

export function isContentPing(
  message: unknown,
): message is typeof CONTENT_PING {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { scope?: string }).scope === CONTENT_PING.scope &&
    (message as { type?: string }).type === CONTENT_PING.type
  );
}
