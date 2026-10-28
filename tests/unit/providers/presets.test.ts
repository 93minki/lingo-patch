import { describe, expect, test } from 'vitest';
import { isFreeModel, PRESETS } from '../../../src/providers/presets';

describe('PRESETS', () => {
  test('lists the three compatible provider presets with official base URLs', () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      'deepseek',
      'groq',
      'openrouter',
    ]);
    expect(PRESETS.find((preset) => preset.id === 'deepseek')?.baseUrl).toBe(
      'https://api.deepseek.com',
    );
    expect(PRESETS.find((preset) => preset.id === 'groq')?.baseUrl).toBe(
      'https://api.groq.com/openai/v1',
    );
    expect(PRESETS.find((preset) => preset.id === 'openrouter')?.baseUrl).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  test('marks free tiers conservatively and only sets RPM when documented globally', () => {
    expect(PRESETS.find((preset) => preset.id === 'deepseek')).toMatchObject({
      free: 'no',
      rpm: null,
    });
    expect(PRESETS.find((preset) => preset.id === 'groq')).toMatchObject({
      free: 'yes',
      rpm: null,
    });
    expect(PRESETS.find((preset) => preset.id === 'openrouter')).toMatchObject({
      free: 'free-models-only',
      rpm: 20,
    });
  });
});

describe('isFreeModel', () => {
  test('detects OpenRouter free model suffix', () => {
    expect(isFreeModel('meta-llama/llama-3.2-3b-instruct:free')).toBe(true);
    expect(isFreeModel('openai/gpt-4o')).toBe(false);
  });
});
