const STYLE_ID = 'lp-style';

export const TRANSLATION_CSS = `
lp-t {
  font: inherit;
  opacity: 0.85;
}
lp-t[data-lp-display="block"] {
  display: block;
  margin-top: 0.25em;
}
lp-t[data-lp-display="inline"] {
  display: inline;
  margin-left: 0.4em;
}
html[data-lp-mode="original"] lp-t {
  display: none !important;
}
html[data-lp-mode="translation"] [data-lp-src-hidden] {
  font-size: 0 !important;
  line-height: 0 !important;
}
html[data-lp-mode="translation"] [data-lp-src-hidden] > [data-lp-src] {
  display: none !important;
}
html[data-lp-mode="translation"] [data-lp-src-hidden] > lp-t {
  font-size: var(--lp-fs) !important;
  line-height: var(--lp-lh) !important;
  margin-top: 0 !important;
}
html[data-lp-mode="translation"] li[data-lp-src-hidden]::marker {
  font-size: 1rem;
}
lp-t[data-lp-state="error"] {
  font-size: 0.85em;
  line-height: 1;
}
lp-t[data-lp-state="pending"] {
  display: none !important;
}
`.trim();

export function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TRANSLATION_CSS;
  const head = doc.head ?? doc.getElementsByTagName('head')[0];
  (head ?? doc.documentElement).appendChild(style);
}
