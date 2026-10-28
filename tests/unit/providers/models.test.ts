import { describe, expect, test } from 'vitest';
import {
  MODEL_CANDIDATES,
  MODEL_TIERS,
  selectModelOptions,
} from '../../../src/providers/models';

describe('selectModelOptions', () => {
  test('returns [] for openai-compatible', () => {
    expect(selectModelOptions('openai-compatible', ['any-model'])).toEqual([]);
  });

  test('picks at most one model per tier in high → mid → low order', () => {
    const available = [
      'claude-haiku-5-5',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ];
    expect(selectModelOptions('anthropic', available).map((o) => o.id)).toEqual(
      ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    );
    expect(
      selectModelOptions('anthropic', available).map((o) => o.tier),
    ).toEqual(MODEL_TIERS);
  });

  test('returns only one high tier option when multiple highs are available', () => {
    expect(
      selectModelOptions('openai', [
        'gpt-6.1-sol',
        'gpt-6-sol',
        'gpt-6-luna',
      ]).map((o) => o.id),
    ).toEqual(['gpt-6.1-sol', 'gpt-6-luna']);
  });

  test('falls back to the next priority id in a tier when the primary is absent', () => {
    expect(
      selectModelOptions('openai', ['gpt-6-sol']).map((o) => o.id),
    ).toEqual(['gpt-6-sol']);
    expect(
      selectModelOptions('openai', ['gpt-5.6-terra', 'gpt-5.6-luna']).map(
        (o) => o.id,
      ),
    ).toEqual(['gpt-5.6-terra', 'gpt-5.6-luna']);
  });

  test('omits tiers with no available candidate', () => {
    expect(
      selectModelOptions('openai', ['gpt-6-luna']).map((o) => o.id),
    ).toEqual(['gpt-6-luna']);
    expect(
      selectModelOptions('gemini', ['gemini-3.8-flash']).map((o) => o.id),
    ).toEqual(['gemini-3.8-flash']);
  });

  test('gemini high prefers preview pro before legacy 2.5 pro', () => {
    expect(MODEL_CANDIDATES.gemini.high.map((o) => o.id)).toEqual([
      'gemini-3.1-pro-preview',
      'gemini-2.5-pro',
    ]);
    expect(
      selectModelOptions('gemini', [
        'gemini-3.1-pro-preview',
        'gemini-2.5-pro',
        'gemini-3.8-flash',
      ]).map((o) => o.id),
    ).toEqual(['gemini-3.1-pro-preview', 'gemini-3.8-flash']);
    expect(
      selectModelOptions('gemini', [
        'gemini-2.5-pro',
        'gemini-3.5-flash-lite',
      ]).map((o) => o.id),
    ).toEqual(['gemini-2.5-pro', 'gemini-3.5-flash-lite']);
  });

  test('gemini low falls back to 3.1 flash-lite when 3.5 is unavailable', () => {
    expect(MODEL_CANDIDATES.gemini.low.map((o) => o.id)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ]);
    expect(
      selectModelOptions('gemini', ['gemini-3.1-flash-lite']).map((o) => o.id),
    ).toEqual(['gemini-3.1-flash-lite']);
  });
});
