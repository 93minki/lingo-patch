import { describe, expect, test } from 'vitest';
import {
  deserialize,
  findSegments,
  isLikelyLang,
  normalizeMarkup,
  serializeInline,
  translationEqualsSource,
} from '../../../src/core/segment';

function root(html: string): Element {
  const element = document.createElement('main');
  element.innerHTML = html;
  return element;
}
function inline(html: string) {
  const element = root(html);
  return { element, ...serializeInline(Array.from(element.childNodes)) };
}
const example =
  'Call <code>useState</code> at the <a href="#top">top level</a>.';

describe('inline serialization and restoration', () => {
  test('matches the design example and preserves source node identity', () => {
    const { element, markup, text, placeholders } = inline(example);
    expect(markup).toBe('Call <x0/> at the <g1>top level</g1>.');
    expect(text).toBe('Call useState at the top level.');
    expect(placeholders.map(({ id, kind }) => [id, kind])).toEqual([
      [0, 'atomic'],
      [1, 'paired'],
    ]);
    expect(placeholders[0]!.node).toBe(element.querySelector('code'));
    const before = element.innerHTML;
    const restored = deserialize(markup, placeholders, document);
    expect(restored.fallback).toBe(false);
    expect(restored.fragment.textContent).toBe(element.textContent);
    const container = document.createElement('div');
    container.append(restored.fragment);
    expect(container.innerHTML).toBe(before);
    expect(container.querySelector('a')!.getAttribute('href')).toBe('#top');
    expect(container.querySelector('code')).not.toBe(placeholders[0]!.node);
    expect(element.innerHTML).toBe(before);
  });
  test('accepts reordered placeholders', () => {
    const { placeholders } = inline(example);
    const result = deserialize(
      '<g1>최상위</g1>에서 <x0/>을 호출하세요.',
      placeholders,
      document,
    );
    expect(result.fallback).toBe(false);
    expect(result.fragment.textContent).toBe(
      '최상위에서 useState을 호출하세요.',
    );
    expect(result.fragment.firstChild!.nodeName).toBe('A');
  });
  test('escapes text and decodes entities once without parsing HTML', () => {
    const { markup, placeholders } = inline('A &lt; B &amp; C &gt; D &amp;lt;');
    expect(markup).toBe('A &lt; B &amp; C &gt; D &amp;lt;');
    const restored = deserialize(markup, placeholders, document);
    expect(restored.fallback).toBe(false);
    expect(restored.fragment.textContent).toBe('A < B & C > D &lt;');
    expect(
      deserialize('&quot;quote&#39;', [], document).fragment.textContent,
    ).toBe('"quote\'');
  });
  test('numbers paired and atomic nodes in opening order, ignores comments', () => {
    const { markup, placeholders } = inline(
      '<strong>Hello <code>x</code> <em>world</em></strong><!--ignored--><button>Click</button><img src="image.png"><br>',
    );
    expect(markup).toBe('<g0>Hello <x1/> <g2>world</g2></g0><x3/><x4/><x5/>');
    expect(placeholders.map((p) => p.kind)).toEqual([
      'paired',
      'atomic',
      'paired',
      'atomic',
      'atomic',
      'atomic',
    ]);
    expect(deserialize(markup, placeholders, document).fallback).toBe(false);
  });
  test.each([
    'Missing <x0/>',
    '<x0/><x0/><g1>duplicate</g1>',
    '<x0/><g1>extra</g1><x2/>',
    '<x0/><g1>unclosed',
    '<x0/><g1>wrong close</g0>',
    '<g0>wrong kind</g0><g1>link</g1>',
    '<x0/><x1/>',
    '<x0/><g1>link</g1></g1>',
    '<script>alert(1)</script><x0/><g1>link</g1>',
  ])('falls back safely for invalid translation: %s', (markup) => {
    const { placeholders } = inline(example);
    const restored = deserialize(markup, placeholders, document);
    expect(restored.fallback).toBe(true);
    expect(restored.fragment.childNodes).toHaveLength(1);
    expect(restored.fragment.firstChild!.nodeType).toBe(3);
    expect(restored.fragment.querySelector('*')).toBeNull();
    expect(restored.fragment.textContent).not.toMatch(/<\/?[gx]\d/);
    if (markup.includes('<script>'))
      expect(restored.fragment.textContent).toContain('<script>');
  });
  test('fallback substitutes atomic placeholders with source textContent', () => {
    const { placeholders } = inline(example);
    const restored = deserialize('Missing <x0/> tail', placeholders, document);
    expect(restored.fallback).toBe(true);
    expect(restored.fragment.textContent).toBe('Missing useState tail');
  });
  test('fallback uses empty string for unknown atomic ids', () => {
    const { placeholders } = inline(example);
    const restored = deserialize('No <x9/> here', placeholders, document);
    expect(restored.fallback).toBe(true);
    expect(restored.fragment.textContent).toBe('No  here');
  });
  test('fallback treats xN as empty when id is paired not atomic', () => {
    const { placeholders } = inline(example);
    const restored = deserialize('<x1/> only', placeholders, document);
    expect(restored.fallback).toBe(true);
    expect(restored.fragment.textContent).toBe(' only');
  });
  test('fallback strips paired tags but keeps inner translated text', () => {
    const { placeholders } = inline(example);
    const restored = deserialize(
      '<g1>최상위</g1>에서 <x0/><x0/>',
      placeholders,
      document,
    );
    expect(restored.fallback).toBe(true);
    expect(restored.fragment.textContent).toBe('최상위에서 useStateuseState');
  });
  test('fallback does not decode entity literals from atomic textContent', () => {
    const { placeholders } = inline('<code>&amp;lt;</code>');
    const restored = deserialize('<x0/><x0/>', placeholders, document);
    expect(restored.fallback).toBe(true);
    expect(restored.fragment.textContent).toBe('&lt;&lt;');
  });
  test('rejects crossing paired tags', () => {
    const { placeholders } = inline('<strong>outer <em>inner</em></strong>');
    expect(
      deserialize('<g0><g1>text</g0></g1>', placeholders, document).fallback,
    ).toBe(true);
  });
  test('normalizes whitespace', () => {
    expect(normalizeMarkup('  Hello\n\t world  ')).toBe('Hello world');
  });
});

describe('translationEqualsSource', () => {
  test('ignores case, whitespace, and placeholder markup', () => {
    expect(translationEqualsSource('Props', 'props')).toBe(true);
    expect(translationEqualsSource('  React  ', 'react')).toBe(true);
    expect(translationEqualsSource('react-dom@19.3', 'react-dom@19.3')).toBe(
      true,
    );
    expect(translationEqualsSource('Hello', 'Goodbye')).toBe(false);
  });
});

describe('block selection', () => {
  test('finds inline content inside nested boundary blocks without duplication', () => {
    const element = root(
      '<ul><li><div><a href="/installation"><span><span>Installation</span></span></a></div><section><em>Other text</em></section></li></ul>',
    );
    const segments = findSegments(element);
    expect(segments.map((segment) => segment.text)).toEqual([
      'Installation',
      'Other text',
    ]);
    expect(segments.map((segment) => segment.block.localName)).toEqual([
      'div',
      'section',
    ]);
  });
  test('skips pre blocks and atomic-only paragraphs, preserves inline code with text', () => {
    const element = root(
      '<pre><code>ignored</code></pre><p><code>onlyCode</code></p><p>Use <code>inlineCode</code> here.</p>',
    );
    expect(findSegments(element).map((s) => s.markup)).toEqual([
      'Use <x0/> here.',
    ]);
    expect(findSegments(element)[0]!.text).toBe('Use inlineCode here.');
  });
  test('skips paragraphs with only atomic inline elements (button, img, multiple code)', () => {
    const element = root(
      '<p><button>Copy</button></p><p><img alt="logo" src="x.png"></p><p><code>a</code>, <code>b</code></p>',
    );
    expect(findSegments(element)).toHaveLength(0);
  });
  test('keeps paragraphs that mix atomic placeholders with real text', () => {
    const element = root('<p>Use <code>map</code> here.</p>');
    const segments = findSegments(element);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.markup).toBe('Use <x0/> here.');
    expect(segments[0]!.text).toBe('Use map here.');
  });
  test('counts letters inside paired elements for segment inclusion', () => {
    const element = root('<p><a href="#">linked</a> words</p>');
    expect(findSegments(element)).toHaveLength(1);
    expect(findSegments(element)[0]!.markup).toBe('<g0>linked</g0> words');
  });
  test('includes paired-only paragraphs without outer text nodes', () => {
    const element = root('<p><a href="#">linked</a></p>');
    expect(findSegments(element)).toHaveLength(1);
    expect(findSegments(element)[0]!.markup).toBe('<g0>linked</g0>');
  });
  test('splits nested lists, preserves anchors and document order', () => {
    const element = root(
      '<ul><li>Item text <ul><li>child</li></ul> After text <div>inner block</div> Final text</li></ul>',
    );
    const segments = findSegments(element);
    expect(segments.map((s) => s.markup)).toEqual([
      'Item text',
      'child',
      'After text',
      'inner block',
      'Final text',
    ]);
    const outer = element.querySelector('li')!;
    expect(segments[0]!.block).toBe(outer);
    expect(segments[0]!.anchor).toBe(outer.querySelector('ul'));
    expect(segments[1]!.anchor).toBeNull();
    expect(segments[2]!.anchor).toBe(outer.querySelector('div'));
    expect(segments[4]!.anchor).toBeNull();
  });
  test.each([
    'pre',
    'script',
    'style',
    'noscript',
    'textarea',
    'select',
    'svg',
    'math',
    'template',
    'iframe',
    'lp-t',
  ])('excludes %s and descendants', (tag) => {
    const element = root(
      `<${tag}>blocked <p>blocked child</p></${tag}><p>Allowed text</p>`,
    );
    expect(findSegments(element).map((s) => s.markup)).toEqual([
      'Allowed text',
    ]);
  });
  test.each([
    'translate="no"',
    'class="notranslate"',
    'hidden',
    'aria-hidden="true"',
    'contenteditable',
    'contenteditable="true"',
    'data-lp-ignore',
  ])('excludes %s including nested inline content and root', (attribute) => {
    const element = root(
      `<div ${attribute}><p>blocked</p></div><p>Allowed <span ${attribute}>blocked inline</span><a> link</a></p>`,
    );
    expect(findSegments(element).map((s) => s.markup)).toEqual([
      'Allowed <g0> link</g0>',
    ]);
    expect(findSegments(element.firstElementChild!)).toEqual([]);
  });
  test('respects excluded ancestors outside root', () => {
    const element = root('<div hidden><section><p>blocked</p></section></div>');
    expect(findSegments(element.querySelector('section')!)).toEqual([]);
  });
  test('filters short, numeric, symbolic and target Korean text', () => {
    const element = root(
      '<p>1234</p><p>!!!</p><p>A</p><p>&amp;</p><p>안녕하세요 세계</p><p>Hello world</p>',
    );
    expect(
      findSegments(element, { targetLang: 'ko' }).map((s) => s.markup),
    ).toEqual(['Hello world']);
    expect(isLikelyLang('한글 English', 'ko')).toBe(false);
    expect(isLikelyLang('한글!!! 123', 'ko')).toBe(true);
    expect(isLikelyLang('한a', 'ko')).toBe(false);
    expect(isLikelyLang('한글', 'en')).toBe(false);
    expect(isLikelyLang('123', 'ko')).toBe(false);
  });
  test('targetLang ignores atomic inline text when judging Korean paragraphs', () => {
    const element = root(
      '<p>안녕하세요 세계 <code>Hello</code></p><p>영어 문장 <code>useState</code></p>',
    );
    expect(
      findSegments(element, { targetLang: 'ko' }).map((s) => s.markup),
    ).toEqual([]);
  });
  test('targetLang ko excludes Korean body with long English code only in markup', () => {
    const element = root(
      '<p>한국어 설명 문장입니다. <code>export function veryLongEnglishIdentifierName() { return null; }</code></p>',
    );
    expect(findSegments(element, { targetLang: 'ko' })).toHaveLength(0);
  });
  test('decodes entities once for inclusion letters in text nodes', () => {
    const element = root('<p>&amp;lt; real</p>');
    expect(findSegments(element).map((s) => s.markup)).toEqual([
      '&amp;lt; real',
    ]);
    expect(findSegments(element)[0]!.text).toBe('&lt; real');
    expect(findSegments(element, { targetLang: 'ko' })).toHaveLength(1);
  });
  test('applies include/exclude to custom blocks and inline descendants', () => {
    const element = root(
      '<custom-block>Custom text</custom-block><p>Keep <a><span class="omit">omit</span>link</a></p><aside class="omit"><p>ignored child</p></aside>',
    );
    expect(
      findSegments(element, {
        rules: { include: ['custom-block'], exclude: ['.omit'] },
      }).map((s) => s.markup),
    ).toEqual(['Custom text', 'Keep <g0>link</g0>']);
  });
  test('recognizes text-bearing containers but keeps spans inside blocks inline', () => {
    const element = root(
      '<div>Direct <span>inline</span><p>Nested paragraph</p></div><span>Standalone text</span>',
    );
    expect(findSegments(element).map((s) => s.markup)).toEqual([
      'Direct <g0>inline</g0>',
      'Nested paragraph',
      'Standalone text',
    ]);
  });
  test('treats inline elements with block children as atomic, without duplicate nodes', () => {
    const element = root(
      '<p>Before <span><div>Nested block</div></span> after</p>',
    );
    const before = element.innerHTML;
    const segments = findSegments(element);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.markup).toBe('Before <x0/> after');
    expect(segments[0]!.placeholders[0]!.node).toBe(
      element.querySelector('span'),
    );
    expect(
      deserialize(segments[0]!.markup, segments[0]!.placeholders, document)
        .fallback,
    ).toBe(false);
    expect(element.innerHTML).toBe(before);
  });
});

test('custom block boundaries inside inline wrappers stay atomic and disjoint', () => {
  const element = root(
    '<p>Before <a><custom-block>Inner text</custom-block></a> after</p>',
  );
  const segments = findSegments(element, {
    rules: { include: ['custom-block'] },
  });
  expect(segments.map((s) => s.markup)).toEqual(['Before <x0/> after']);
  expect(segments[0]!.placeholders[0]!.node).toBe(element.querySelector('a'));
  expect(
    deserialize(segments[0]!.markup, segments[0]!.placeholders, document)
      .fallback,
  ).toBe(false);
});

test('skips atomic subtrees containing excluded descendants', () => {
  const element = root(
    '<p>Allowed <button>Click <span hidden>secret</span></button> text</p>',
  );
  expect(findSegments(element).map((s) => s.markup)).toEqual(['Allowed text']);
});

test('treats literal angle brackets and encoded unknown tags as text', () => {
  const plain = deserialize('A < B &amp; C', [], document);
  expect(plain.fallback).toBe(false);
  expect(plain.fragment.textContent).toBe('A < B & C');
  const encoded = deserialize(
    '&lt;script&gt;literal&lt;/script&gt;',
    [],
    document,
  );
  expect(encoded.fallback).toBe(false);
  expect(encoded.fragment.querySelector('script')).toBeNull();
  expect(encoded.fragment.textContent).toBe('<script>literal</script>');
});

test('rejects balanced translations that change original placeholder ancestry', () => {
  const { placeholders } = inline(
    '<strong>outer <em>inner</em><code>value</code></strong>',
  );
  expect(
    deserialize('<g1><g0>text<x2/></g0></g1>', placeholders, document).fallback,
  ).toBe(true);
  expect(
    deserialize('<g0><g1>text</g1></g0><x2/>', placeholders, document).fallback,
  ).toBe(true);
  expect(
    deserialize(
      '<g0><x2/><g1>reordered siblings</g1></g0>',
      placeholders,
      document,
    ).fallback,
  ).toBe(false);
});
