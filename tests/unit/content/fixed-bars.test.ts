import { expect, test, vi } from 'vitest';
import { createFixedBarFilter } from '../../../src/content/fixed-bars';

test('skips short fixed and sticky ancestors while preserving a tall fixed sidebar and caching lookups', () => {
  document.body.innerHTML =
    '<header style="position:sticky"><p>One</p><p>Two</p></header><aside style="position:fixed"><p>Sidebar</p></aside><main><p>Body</p></main>';
  const header = document.querySelector('header')!,
    sidebar = document.querySelector('aside')!;
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
    height: 64,
  } as DOMRect);
  vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
    height: 600,
  } as DOMRect);
  const style = vi.spyOn(window, 'getComputedStyle');
  const exclude = createFixedBarFilter(document);
  const a = header.querySelectorAll('p');
  expect(exclude(a[0]!)).toBe(true);
  expect(exclude(a[1]!)).toBe(true);
  expect(
    style.mock.calls.filter(([element]) => element === header),
  ).toHaveLength(1);
  expect(exclude(sidebar.querySelector('p')!)).toBe(false);
  expect(exclude(document.querySelector('main p')!)).toBe(false);
  const zeroHeight = document.createElement('div');
  zeroHeight.style.position = 'fixed';
  document.body.append(zeroHeight);
  expect(exclude(zeroHeight)).toBe(true);
  style.mockRestore();
});
