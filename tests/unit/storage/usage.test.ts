import { expect, test, vi } from 'vitest';
import {
  filterUsage,
  recordUsage,
  totalUsage,
  formatTokens,
} from '../../../src/core/usage';
const mock = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async () => ({ ...mock.data }),
        set: async (value: Record<string, unknown>) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          Object.assign(mock.data, value);
        },
        remove: async (key: string) => {
          delete mock.data[key];
        },
      },
    },
  },
}));
import { saveUsage, getUsage, clearUsage } from '../../../src/storage/usage';

test('aggregate and filter calendar dates, including 90-day boundary', () => {
  const count = { requests: 1, inputTokens: 10, outputTokens: 4 };
  let data = recordUsage({}, '2026-01-01', 'a', 'm', count);
  data = recordUsage(data, '2026-01-02', 'a', 'm', count);
  data = recordUsage(data, '2026-04-01', 'b', 'n', count);
  expect(totalUsage(filterUsage(data, new Date(2026, 3, 1), 90))).toEqual({
    requests: 2,
    inputTokens: 20,
    outputTokens: 8,
  });
  expect(totalUsage(filterUsage(data, new Date(2026, 3, 1), 1))).toEqual(count);
  expect(formatTokens(12300)).toBe('12.3k');
  expect(formatTokens(2100000)).toBe('2.1M');
});
test('concurrent records and clear are serialized', async () => {
  await clearUsage();
  await Promise.all(
    Array.from({ length: 20 }, () =>
      saveUsage('a', 'm', { requests: 1, inputTokens: 2, outputTokens: 3 }),
    ),
  );
  expect(totalUsage(await getUsage())).toEqual({
    requests: 20,
    inputTokens: 40,
    outputTokens: 60,
  });
  await clearUsage();
  expect(await getUsage()).toEqual({});
});
