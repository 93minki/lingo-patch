import { beforeEach, expect, test, vi } from 'vitest';
import { SegmentRenderer } from '../../../src/content/renderer';
import { findSegments } from '../../../src/core/segment';

beforeEach(() => {
  document.body.innerHTML = '';
});
function setup(
  html = '<p class="source" style="font-size:22px">Use <code>map</code> <a href="#top">here</a>.</p>',
) {
  document.body.innerHTML = html;
  const renderer = new SegmentRenderer(document);
  const segment = findSegments(document.body)[0]!;
  return {
    renderer,
    record: renderer.create('key', segment),
    block: segment.block,
  };
}
test('renders with cloned inline nodes while preserving every source text and attribute', () => {
  const { renderer, record, block } = setup();
  const code = block.querySelector('code')!;
  const anchor = block.querySelector('a')!;
  const sourceText = [...block.childNodes].map((node) => node.textContent);
  const attrs = [...block.attributes].map((a) => [a.name, a.value]);
  renderer.render(record, 'ready', '<g1>여기</g1>에서 <x0/>을 사용하세요.');
  expect(record.node!.textContent).toBe('여기에서 map을 사용하세요.');
  expect(record.node!.dataset.lpDisplay).toBe('block');
  expect(record.node!.style.getPropertyValue('--lp-fs')).toBe('22px');
  expect(record.node!.style.getPropertyValue('--lp-lh')).not.toBe('');
  expect(code.hasAttribute('data-lp-src')).toBe(true);
  expect(anchor.hasAttribute('data-lp-src')).toBe(true);
  expect(block.querySelector('code')).toBe(code);
  expect(block.querySelector('a')).toBe(anchor);
  expect(
    [...block.childNodes]
      .filter((n) => n !== record.node)
      .map((n) => n.textContent),
  ).toEqual(sourceText);
  expect(
    [...block.attributes]
      .filter((a) => !a.name.startsWith('data-lp-'))
      .map((a) => [a.name, a.value]),
  ).toEqual(attrs);
  renderer.render(record, 'ready', '<g1>여기</g1>에서 <x0/>을 사용하세요.');
  expect(block.querySelectorAll('lp-t')).toHaveLength(1);
  renderer.clear([record]);
  expect(code.hasAttribute('data-lp-src')).toBe(false);
  expect(anchor.hasAttribute('data-lp-src')).toBe(false);
  expect(block.outerHTML).toBe(
    '<p class="source" style="font-size:22px">Use <code>map</code> <a href="#top">here</a>.</p>',
  );
});
test('inserts before the nested-block anchor', () => {
  const { renderer, record, block } = setup(
    '<ul><li>Parent text<ul><li>Child text</li></ul></li></ul>',
  );
  renderer.render(record, 'ready', '부모 문장');
  expect(record.node!.nextSibling).toBe(block.querySelector('ul'));
});
test.each([
  ['flex', 'column', 'block'],
  ['flex', 'row', 'inline'],
  ['grid', 'row', 'inline'],
  ['inline', 'row', 'inline'],
])(
  'classifies %s %s as %s without modifying source styles',
  (display, direction, expected) => {
    const { renderer, record, block } = setup(
      `<div style="display:${display};flex-direction:${direction}">Source text</div>`,
    );
    const before = block.getAttribute('style');
    renderer.render(record, 'ready', '번역문');
    expect(record.node!.dataset.lpDisplay).toBe(expected);
    expect(block.getAttribute('style')).toBe(before);
  },
);
test('pending and error indicators do not hide original content', () => {
  const { renderer, record, block } = setup();
  renderer.render(record, 'pending');
  expect(record.node!.textContent).toBe('');
  expect(block.hasAttribute('data-lp-src-hidden')).toBe(false);
  renderer.render(record, 'error');
  expect(record.node!.textContent).toBe('⚠');
  expect(block.hasAttribute('data-lp-src-hidden')).toBe(false);
});
test('restores removed translations from memory and abandons repeated removals once', () => {
  const { renderer, record, block } = setup();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  renderer.render(record, 'ready', '번역문');
  for (let count = 0; count < 4; count++) {
    record.node!.remove();
    renderer.restore(record, 1000 + count);
  }
  expect(record.abandoned).toBe(true);
  expect(block.querySelector('lp-t')).toBeNull();
  expect(warn).toHaveBeenCalledOnce();
  renderer.restore(record, 2000);
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});
test('does not restore a stale translation after source text changed', () => {
  const { renderer, record, block } = setup();
  renderer.render(record, 'ready', '옛 번역');
  record.node!.remove();
  block.firstChild!.textContent = 'Changed source ';
  renderer.restore(record);
  expect(block.querySelector('lp-t')).toBeNull();
});
test('skips lp-t when translation matches source text', () => {
  const { renderer, record, block } = setup('<p>Props stay</p>');
  renderer.render(record, 'ready', 'Props stay');
  expect(block.querySelector('lp-t')).toBeNull();
  expect(block.hasAttribute('data-lp-src-hidden')).toBe(false);
  renderer.render(record, 'ready', 'PROPS   stay');
  expect(block.querySelector('lp-t')).toBeNull();
});
test('ready-to-error and removal release only our source hiding marker', () => {
  const { renderer, record, block } = setup();
  renderer.render(record, 'ready', '번역문');
  expect(block.hasAttribute('data-lp-src-hidden')).toBe(true);
  renderer.render(record, 'error');
  expect(block.hasAttribute('data-lp-src-hidden')).toBe(false);
});
test('repeated removals are counted per block across its separate segments', () => {
  document.body.innerHTML =
    '<li>First paragraph<ul><li>Nested paragraph</li></ul>Second paragraph</li>';
  const renderer = new SegmentRenderer(document);
  const block = document.querySelector('li')!;
  const records = findSegments(document.body)
    .filter((segment) => segment.block === block)
    .map((segment, index) => renderer.create(String(index), segment));
  expect(records).toHaveLength(2);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (const record of records) renderer.render(record, 'ready', '번역문');
  for (let index = 0; index < 4; index++) {
    const record = records[index % 2]!;
    record.node!.remove();
    renderer.restore(record, 1000 + index);
  }
  expect(records[1]!.abandoned).toBe(true);
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});
test('uses current atomic source after page rerenders the same markup', () => {
  const { renderer, record, block } = setup(
    '<p>Use <code>oldIdentifier</code> here</p>',
  );
  renderer.render(record, 'ready', '여기서 <x0/> 사용');
  record.node!.remove();
  const replacement = document.createElement('code');
  replacement.textContent = 'newIdentifier';
  block.querySelector('code')!.replaceWith(replacement);
  renderer.restore(record);
  expect(record.node!.querySelector('code')!.textContent).toBe('newIdentifier');
});
test('re-rendered translations keep cloned inline nodes visible in translation-only mode', () => {
  const { renderer, record } = setup();
  renderer.render(record, 'ready', '<g1>여기</g1>에서 <x0/>을 사용하세요.');
  renderer.render(record, 'ready', '<g1>여기</g1>에서 <x0/>을 사용하세요!');
  expect(record.node!.querySelectorAll('[data-lp-src]')).toHaveLength(0);
  expect(record.node!.querySelector('code')!.textContent).toBe('map');
});
test('marks source inline nodes of every segment sharing a block', () => {
  document.body.innerHTML =
    '<li>Use <code>a</code> first<ul><li>Nested paragraph</li></ul>Then <em>second</em> part</li>';
  const renderer = new SegmentRenderer(document);
  const block = document.querySelector('li')!;
  const records = findSegments(document.body)
    .filter((segment) => segment.block === block)
    .map((segment, index) => renderer.create(String(index), segment));
  expect(records).toHaveLength(2);
  for (const record of records) renderer.render(record, 'ready', '번역문');
  expect(
    block.querySelector(':scope > code')!.hasAttribute('data-lp-src'),
  ).toBe(true);
  expect(block.querySelector(':scope > em')!.hasAttribute('data-lp-src')).toBe(
    true,
  );
});
