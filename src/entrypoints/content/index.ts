import { defineContentScript } from 'wxt/utils/define-content-script';
import { startPagePipeline } from '../../content/pipeline';
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main(ctx) {
    const dispose = startPagePipeline();
    ctx.onInvalidated(dispose);
  },
});
