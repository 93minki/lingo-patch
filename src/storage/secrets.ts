import { browser } from 'wxt/browser';

const STORAGE_KEY = 'lp-secrets';
let writeQueue: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => {},
    () => {},
  );
  return next;
}
async function readSecrets(): Promise<Record<string, string>> {
  const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(
      ([id, key]) => /^[a-z0-9-]+$/u.test(id) && typeof key === 'string',
    ),
  ) as Record<string, string>;
}
export async function getApiKey(id: string): Promise<string | undefined> {
  await writeQueue;
  return (await readSecrets())[id];
}
export async function setApiKey(id: string, key: string): Promise<void> {
  if (!/^[a-z0-9-]+$/u.test(id) || typeof key !== 'string')
    throw new Error('Invalid key identifier');
  await enqueue(async () => {
    const secrets = await readSecrets();
    secrets[id] = key;
    await browser.storage.local.set({ [STORAGE_KEY]: secrets });
  });
}
export async function migrateApiKey(id: string, key: string): Promise<void> {
  if (!/^[a-z0-9-]+$/u.test(id)) throw new Error('Invalid key identifier');
  await enqueue(async () => {
    const secrets = await readSecrets();
    if (Object.hasOwn(secrets, id)) return;
    secrets[id] = key;
    await browser.storage.local.set({ [STORAGE_KEY]: secrets });
  });
}
export async function clearApiKey(id: string): Promise<void> {
  await enqueue(async () => {
    const secrets = await readSecrets();
    delete secrets[id];
    await browser.storage.local.set({ [STORAGE_KEY]: secrets });
  });
}
export async function clearAllApiKeys(): Promise<void> {
  await enqueue(() => browser.storage.local.remove(STORAGE_KEY));
}
export function onSecretsChanged(
  listener: (ids: string[]) => void,
): () => void {
  const changed = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: string,
  ) => {
    const change = changes[STORAGE_KEY];
    if (area !== 'local' || !change) return;
    const values = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const before = values(change.oldValue);
    const after = values(change.newValue);
    listener(
      [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (id) => before[id] !== after[id],
      ),
    );
  };
  browser.storage.onChanged.addListener(changed);
  return () => browser.storage.onChanged.removeListener(changed);
}
