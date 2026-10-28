import { defineContentScript } from 'wxt/utils/define-content-script';

function initialize() {}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main: initialize,
});
