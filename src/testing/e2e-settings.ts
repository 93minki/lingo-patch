import { getSettings, updateSettings } from '../storage/settings';
import { setApiKey } from '../storage/secrets';
export async function bootstrapE2E(): Promise<void> {
  if ((await getSettings()).provider) return;
  await setApiKey('openai-compatible', '');
  await updateSettings({
    provider: {
      provider: 'openai-compatible',
      model: 'lingo-patch-e2e-mock',
      baseUrl: 'http://127.0.0.1:4174/v1',
    },
    autoSites: ['127.0.0.1'],
    targetLang: 'ko',
    displayMode: 'bilingual',
  });
}
