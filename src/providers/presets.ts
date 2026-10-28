export type PresetId = 'deepseek' | 'groq' | 'openrouter';

export type PresetFree = 'yes' | 'no' | 'free-models-only';

export interface ProviderPreset {
  id: PresetId;
  label: string;
  baseUrl: string;
  free: PresetFree;
  rpm: number | null;
  signupUrl: string;
  docsUrl: string;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    free: 'no',
    rpm: null,
    signupUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    free: 'yes',
    rpm: null,
    signupUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs/rate-limits',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    free: 'free-models-only',
    rpm: 20,
    signupUrl: 'https://openrouter.ai/settings/keys',
    docsUrl: 'https://openrouter.ai/docs/api-reference/limits',
  },
];

export function isFreeModel(id: string): boolean {
  return id.endsWith(':free');
}
