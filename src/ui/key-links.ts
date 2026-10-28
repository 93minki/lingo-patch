import { PRESETS } from '../providers/presets';

/** Official API key signup pages (provider documentation). */
export const KEY_LINKS = {
  gemini: {
    signup: 'https://aistudio.google.com/apikey',
    docs: 'https://ai.google.dev/gemini-api/docs/api-key',
  },
  openai: {
    signup: 'https://platform.openai.com/api-keys',
    docs: 'https://platform.openai.com/docs/api-reference/authentication',
  },
  anthropic: {
    signup: 'https://platform.claude.com/settings/keys',
    docs: 'https://platform.claude.com/docs/en/api/overview',
  },
  deepseek: {
    signup: PRESETS.find((p) => p.id === 'deepseek')!.signupUrl,
    docs: PRESETS.find((p) => p.id === 'deepseek')!.docsUrl,
  },
  groq: {
    signup: PRESETS.find((p) => p.id === 'groq')!.signupUrl,
    docs: PRESETS.find((p) => p.id === 'groq')!.docsUrl,
  },
  openrouter: {
    signup: PRESETS.find((p) => p.id === 'openrouter')!.signupUrl,
    docs: PRESETS.find((p) => p.id === 'openrouter')!.docsUrl,
  },
} as const;

export const SHORTCUTS_HELP_URL = 'chrome://extensions/shortcuts';
