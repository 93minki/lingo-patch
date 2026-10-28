import type { ProviderId } from './types';

export type ModelTier = 'high' | 'mid' | 'low';

export interface ModelOption {
  id: string;
  label: string;
  tier: ModelTier;
}

export const MODEL_TIERS: ModelTier[] = ['high', 'mid', 'low'];

export const MODEL_CANDIDATES: Record<
  Exclude<ProviderId, 'openai-compatible'>,
  Record<ModelTier, ModelOption[]>
> = {
  anthropic: {
    high: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', tier: 'high' }],
    mid: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', tier: 'mid' }],
    low: [{ id: 'claude-haiku-5-5', label: 'Haiku 5.5', tier: 'low' }],
  },
  openai: {
    high: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tier: 'high' },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol', tier: 'high' },
    ],
    mid: [
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', tier: 'mid' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', tier: 'mid' },
    ],
    low: [
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', tier: 'low' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', tier: 'low' },
    ],
  },
  gemini: {
    high: [
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro (preview)',
        tier: 'high',
      },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'high' },
    ],
    mid: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'mid' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', tier: 'mid' },
    ],
    low: [
      {
        id: 'gemini-3.5-flash-lite',
        label: 'Gemini 3.5 Flash-Lite',
        tier: 'low',
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash-Lite',
        tier: 'low',
      },
    ],
  },
};

export function selectModelOptions(
  provider: ProviderId,
  available: string[],
): ModelOption[] {
  if (provider === 'openai-compatible') return [];
  const availableSet = new Set(available);
  const selected: ModelOption[] = [];
  for (const tier of MODEL_TIERS) {
    const pick = MODEL_CANDIDATES[provider][tier].find((option) =>
      availableSet.has(option.id),
    );
    if (pick) selected.push(pick);
  }
  return selected;
}
