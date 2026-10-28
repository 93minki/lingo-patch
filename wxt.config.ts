import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  manifest: ({ mode }) => ({
    name: 'lingo-patch',
    permissions: ['storage', 'alarms'],
    host_permissions: [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.deepseek.com/*',
      'https://api.groq.com/*',
      'https://openrouter.ai/*',
      ...(mode === 'e2e' ? ['http://127.0.0.1/*'] : []),
    ],
    optional_host_permissions: ['https://*/*', 'http://localhost/*'],
    commands: {
      'toggle-translate': {
        suggested_key: { default: 'Alt+A' },
        description: 'Toggle page translation',
      },
      'cycle-mode': {
        suggested_key: { default: 'Alt+S' },
        description: 'Cycle translation display mode',
      },
    },
    browser_specific_settings: {
      gecko: { id: 'lingo-patch@local' },
    },
  }),
  vite: () => ({ plugins: [preact()] }),
});
