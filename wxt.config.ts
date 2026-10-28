import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'lingo-patch',
    permissions: ['storage', 'alarms'],
    host_permissions: [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    optional_host_permissions: [
      'https://*/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
    browser_specific_settings: {
      gecko: { id: 'lingo-patch@local' },
    },
  },
  vite: () => ({ plugins: [preact()] }),
});
