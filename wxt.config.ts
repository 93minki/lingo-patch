import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'lingo-patch',
    permissions: ['storage', 'alarms'],
    browser_specific_settings: {
      gecko: { id: 'lingo-patch@local' },
    },
  },
  vite: () => ({ plugins: [preact()] }),
});
