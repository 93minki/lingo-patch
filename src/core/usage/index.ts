export interface UsageCounts {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}
export type UsageData = Record<
  string,
  Record<string, Record<string, UsageCounts>>
>;
export const emptyUsage = (): UsageCounts => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
});
export function addUsage(a: UsageCounts, b: UsageCounts): UsageCounts {
  return {
    requests: a.requests + b.requests,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function cutoffDate(now: Date, days: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() - days + 1);
  return localDate(date);
}
export function filterUsage(
  data: UsageData,
  now: Date,
  days: number,
): UsageData {
  const cutoff = cutoffDate(now, days),
    today = localDate(now);
  return Object.fromEntries(
    Object.entries(data).filter(([date]) => date >= cutoff && date <= today),
  );
}
export function totalUsage(data: UsageData): UsageCounts {
  let total = emptyUsage();
  for (const providers of Object.values(data))
    for (const models of Object.values(providers))
      for (const counts of Object.values(models))
        total = addUsage(total, counts);
  return total;
}
export function recordUsage(
  data: UsageData,
  date: string,
  provider: string,
  model: string,
  counts: UsageCounts,
): UsageData {
  const providers = data[date] ?? {},
    models = providers[provider] ?? {};
  return {
    ...data,
    [date]: {
      ...providers,
      [provider]: {
        ...models,
        [model]: addUsage(models[model] ?? emptyUsage(), counts),
      },
    },
  };
}

export function formatTokens(value: number): string {
  const unit = value >= 1_000_000 ? 1_000_000 : value >= 1_000 ? 1_000 : 1;
  return unit === 1
    ? String(value)
    : `${Number((value / unit).toFixed(1))}${unit === 1_000 ? 'k' : 'M'}`;
}
