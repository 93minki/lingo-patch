import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  deserialize,
  findSegments,
  type Segment,
} from '../../../src/core/segment';

const fixtures = [
  'react-learn',
  'mdn-array-map',
  'docusaurus-intro',
  'vitepress-guide',
  'rust-book-ch01',
];

function markupWithoutPlaceholders(markup: string): string {
  return markup
    .replace(/<x\d+\/>/gu, '')
    .replace(/<\/?g\d+>/gu, '')
    .trim();
}

// Source ranges end before the anchor and begin after the preceding block boundary.
function sourceNodes(segment: Segment): Node[] {
  const nodes: Node[] = [];
  let node = segment.anchor
    ? segment.anchor.previousSibling
    : segment.block.lastChild;
  while (node) {
    if (
      node.nodeType === 1 &&
      (node as Element).matches(
        'p,li,h1,h2,h3,h4,h5,h6,td,th,dt,dd,blockquote,figcaption,summary,caption,label,legend,address,article,aside,div,dl,fieldset,figure,footer,form,header,hgroup,hr,main,nav,ol,section,table,tbody,thead,tfoot,tr,ul,pre',
      )
    )
      break;
    nodes.push(node);
    node = node.previousSibling;
  }
  return nodes;
}

test.each(fixtures)(
  '%s: sanitized fixture, disjoint segments and safe round trips',
  (name) => {
    const html = readFileSync(`tests/fixtures/${name}.html`, 'utf8');
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(300 * 1024);
    expect(html).not.toMatch(/<(?:script|style|link|noscript|iframe)\b|<!--/iu);
    document.body.innerHTML = html;
    const before = document.body.innerHTML;
    const start = performance.now();
    const segments = findSegments(document.body);
    const elapsed = performance.now() - start;
    console.log(
      JSON.stringify({
        fixture: name,
        segments: segments.length,
        milliseconds: Number(elapsed.toFixed(2)),
        first5: segments.slice(0, 5).map((s) => s.markup),
      }),
    );
    expect(segments.length).toBeGreaterThan(20);
    expect(elapsed).toBeLessThanOrEqual(200);
    const seen = new Set<Node>();
    for (const segment of segments) {
      expect(/\p{L}/u.test(markupWithoutPlaceholders(segment.markup))).toBe(
        true,
      );
      expect(segment.block.closest('pre')).toBeNull();
      for (const source of sourceNodes(segment)) {
        const walker = document.createTreeWalker(source);
        let node: Node | null = source;
        while (node) {
          expect(seen.has(node)).toBe(false);
          seen.add(node);
          node = walker.nextNode();
        }
      }
      const restored = deserialize(
        segment.markup,
        segment.placeholders,
        document,
      );
      expect(restored.fallback).toBe(false);
    }
    expect(document.body.innerHTML).toBe(before);
  },
);
