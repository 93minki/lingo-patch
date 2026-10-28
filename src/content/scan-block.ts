/** Block selectors aligned with `findSegments` in `src/core/segment`. */
const candidates =
  'p,li,h1,h2,h3,h4,h5,h6,td,th,dt,dd,blockquote,figcaption,summary,caption,label,legend';
const boundaries = `${candidates},address,article,aside,div,dl,fieldset,figure,footer,form,header,hgroup,hr,main,nav,ol,section,table,tbody,thead,tfoot,tr,ul,pre`;

function isGenericBlock(element: Element): boolean {
  if (
    !element.matches('div,section,article,span') &&
    !element.matches(boundaries)
  )
    return false;
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === 3 && node.textContent?.trim(),
  );
}

/** Nearest element that `findSegments` may treat as a block root. */
export function nearestScanRoot(node: Node, body: Element): Element | null {
  let current: Element | null =
    node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (current && current !== body) {
    if (current.closest('lp-t')) return null;
    if (current.matches(candidates) || isGenericBlock(current)) return current;
    current = current.parentElement;
  }
  if (current === body && node.nodeType === 1) {
    const element = node as Element;
    if (element.matches(candidates) || isGenericBlock(element)) return element;
  }
  // Fall back to the nearest structural container instead of the whole body.
  const start = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const container = start?.closest(boundaries);
  if (container && container !== body && body.contains(container))
    return container;
  return body;
}

export function isBodyDirectSwap(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  if (element.localName === 'lp-t') return false;
  if (element.parentElement !== document.body) return false;
  if (element.matches(candidates)) return false;
  return true;
}
