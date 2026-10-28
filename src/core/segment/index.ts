export interface SegmentRules {
  include?: string[];
  exclude?: string[];
}

export interface Placeholder {
  id: number;
  kind: 'atomic' | 'paired';
  node: Element;
}

export interface Segment {
  block: Element;
  anchor: Node | null;
  markup: string;
  text: string;
  placeholders: Placeholder[];
}

const candidates =
  'p,li,h1,h2,h3,h4,h5,h6,td,th,dt,dd,blockquote,figcaption,summary,caption,label,legend';
const boundaries = `${candidates},address,article,aside,div,dl,fieldset,figure,footer,form,header,hgroup,hr,main,nav,ol,section,table,tbody,thead,tfoot,tr,ul,pre`;
const excluded =
  'pre,script,style,noscript,textarea,select,svg,math,template,iframe,[contenteditable=""],[contenteditable="true"],[translate="no"],.notranslate,[aria-hidden="true"],[hidden],lp-t,[data-lp-ignore]';
const paired = new Set(
  'a em strong b i u s mark span abbr small sub sup q cite del ins time'.split(
    ' ',
  ),
);

export function normalizeMarkup(markup: string): string {
  return markup.replace(/\s+/gu, ' ').trim();
}

export function isLikelyLang(text: string, lang: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  return (
    lang === 'ko' &&
    letters.length > 0 &&
    letters.filter((char) => /\p{Script=Hangul}/u.test(char)).length /
      letters.length >
      0.5
  );
}

function escapeText(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

function isPaired(element: Element, blockSelector = boundaries): boolean {
  return paired.has(element.localName) && !element.querySelector(blockSelector);
}

function serialize(
  nodes: Node[],
  skip?: (element: Element) => boolean,
  blockSelector = boundaries,
) {
  const placeholders: Placeholder[] = [];
  let text = '';
  function visit(node: Node): string {
    if (node.nodeType === 3) {
      text += node.textContent ?? '';
      return escapeText(node.textContent ?? '');
    }
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (skip?.(element)) return '';
    const kind = isPaired(element, blockSelector) ? 'paired' : 'atomic';
    // An atomic clone cannot omit excluded descendants without changing its source.
    if (
      kind === 'atomic' &&
      skip &&
      Array.from(element.querySelectorAll('*')).some(skip)
    )
      return '';
    const id = placeholders.length;
    placeholders.push({ id, kind, node: element });
    if (kind === 'paired')
      return `<g${id}>${Array.from(node.childNodes).map(visit).join('')}</g${id}>`;
    text += node.textContent ?? '';
    return `<x${id}/>`;
  }
  const markup = normalizeMarkup(nodes.map(visit).join(''));
  return { markup, text, placeholders };
}

const placeholderStrip = /<x\d+\/>|<\/?g\d+>/gu;

function translatableText(markup: string): string {
  return decodeText(markup.replace(placeholderStrip, ''));
}

export function serializeInline(nodes: Node[]): {
  markup: string;
  text: string;
  placeholders: Placeholder[];
} {
  return serialize(nodes);
}

export function findSegments(
  root: Element,
  opts?: { rules?: SegmentRules; targetLang?: string },
): Segment[] {
  const excludeSelector = [excluded, ...(opts?.rules?.exclude ?? [])].join(',');
  const includeSelector = [candidates, ...(opts?.rules?.include ?? [])].join(
    ',',
  );
  const boundarySelector = [boundaries, ...(opts?.rules?.include ?? [])].join(
    ',',
  );
  if (root.closest(excludeSelector)) return [];
  const active = new WeakMap<Element, Element>();
  const blocks: Element[] = [];
  const accept = (element: Element): number => {
    if (element.matches(excludeSelector)) return 2;
    const parentBlock = element.parentElement
      ? active.get(element.parentElement)
      : undefined;
    if (
      parentBlock &&
      !element.matches(boundarySelector) &&
      !isPaired(element, boundarySelector)
    )
      return 2;
    const generic =
      element.matches('div,section,article,span') &&
      Array.from(element.childNodes).some(
        (node) => node.nodeType === 3 && node.textContent?.trim(),
      ) &&
      (element.localName !== 'span' || !parentBlock);
    if (element.matches(includeSelector) || generic) {
      blocks.push(element);
      active.set(element, element);
    } else if (parentBlock) active.set(element, parentBlock);
    return 1;
  };
  accept(root);
  const walker = root.ownerDocument.createTreeWalker(root, 1, {
    acceptNode: (node) => accept(node as Element),
  });
  while (walker.nextNode()) {
    /* The filter records blocks and prunes excluded/atomic subtrees. */
  }
  const found: { segment: Segment; first: Node }[] = [];
  const skip = (element: Element) => element.matches(excludeSelector);
  for (const block of blocks) {
    let pending: Node[] = [];
    const flush = (anchor: Node | null) => {
      if (!pending.length) return;
      const serialized = serialize(pending, skip, boundarySelector);
      const judgment = translatableText(serialized.markup);
      const compact = judgment.replace(/\s/gu, '');
      if (
        [...compact].length >= 2 &&
        /\p{L}/u.test(compact) &&
        !(opts?.targetLang && isLikelyLang(judgment, opts.targetLang))
      ) {
        found.push({
          segment: { block, anchor, ...serialized },
          first: pending[0]!,
        });
      }
      pending = [];
    };
    for (const node of Array.from(block.childNodes)) {
      if (node.nodeType === 1 && (node as Element).matches(boundarySelector))
        flush(node);
      else pending.push(node);
    }
    flush(null);
  }
  found.sort((a, b) => (a.first.compareDocumentPosition(b.first) & 4 ? -1 : 1));
  return found.map(({ segment }) => segment);
}

const entities: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
function decodeText(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|#39);/gu,
    (entity) => entities[entity]!,
  );
}

function fallbackPlainText(
  markup: string,
  originals: Map<number, Placeholder>,
): string {
  let out = '';
  for (const token of markup.match(
    /<x\d+\/>|<g\d+>|<\/g\d+>|<[^>]*>|[^<]+|</gu,
  ) ?? []) {
    const match = /^(<x|<g|<\/g)(\d+)(?:\/>|>)$/u.exec(token);
    if (!match) {
      out += decodeText(token);
      continue;
    }
    const id = Number(match[2]);
    if (match[1] === '<x') {
      const original = originals.get(id);
      out +=
        original?.kind === 'atomic' ? (original.node.textContent ?? '') : '';
      continue;
    }
  }
  return out;
}

export function deserialize(
  markup: string,
  placeholders: Placeholder[],
  doc: Document,
): { fragment: DocumentFragment; fallback: boolean } {
  const fragment = doc.createDocumentFragment();
  const originals = new Map(
    placeholders.map((placeholder) => [placeholder.id, placeholder]),
  );
  const idsByNode = new Map(placeholders.map(({ id, node }) => [node, id]));
  const parents = new Map<number, number>();
  for (const { id, node } of placeholders) {
    let parent = node.parentElement;
    while (parent && !idsByNode.has(parent)) parent = parent.parentElement;
    parents.set(id, parent ? idsByNode.get(parent)! : -1);
  }
  const seen = new Set<number>();
  const stack: { id: number; node: Node }[] = [{ id: -1, node: fragment }];
  let invalid = originals.size !== placeholders.length;
  // Only these tokens have syntax; every other tag remains literal text.
  for (const token of markup.match(
    /<x\d+\/>|<g\d+>|<\/g\d+>|<[^>]*>|[^<]+|</gu,
  ) ?? []) {
    const match = /^(<x|<g|<\/g)(\d+)(?:\/>|>)$/u.exec(token);
    if (!match) {
      if (token.startsWith('<') && token.endsWith('>')) invalid = true;
      stack[stack.length - 1]!.node.appendChild(
        doc.createTextNode(decodeText(token)),
      );
      continue;
    }
    const id = Number(match[2]);
    const original = originals.get(id);
    if (match[1] === '</g') {
      if (stack.length === 1 || stack[stack.length - 1]!.id !== id)
        invalid = true;
      else stack.pop();
      continue;
    }
    const kind = match[1] === '<x' ? 'atomic' : 'paired';
    if (
      !original ||
      original.kind !== kind ||
      seen.has(id) ||
      parents.get(id) !== stack[stack.length - 1]!.id
    ) {
      invalid = true;
      continue;
    }
    seen.add(id);
    const clone = original.node.cloneNode(kind === 'atomic');
    stack[stack.length - 1]!.node.appendChild(clone);
    if (kind === 'paired') stack.push({ id, node: clone });
  }
  if (invalid || stack.length !== 1 || seen.size !== originals.size) {
    const fallback = doc.createDocumentFragment();
    fallback.appendChild(
      doc.createTextNode(fallbackPlainText(markup, originals)),
    );
    return { fragment: fallback, fallback: true };
  }
  return { fragment, fallback: false };
}
