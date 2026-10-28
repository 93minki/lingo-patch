import { expect, test } from 'vitest';
import { findHoverSegment } from '../../../src/content/hover-segment';

test('uses actual nearest segment block including nested sidebar divs', () => {
  document.body.innerHTML =
    '<ul><li><div><a><span>Installation</span></a></div></li></ul><p hidden>Hidden text</p>';
  const span = document.querySelector('span')!;
  const result = findHoverSegment(span, document.body, 'ko');
  expect(result?.block).toBe(document.querySelector('li div'));
  expect(result?.text).toBe('Installation');
  expect(
    findHoverSegment(document.querySelector('p')!, document.body, 'ko'),
  ).toBeUndefined();
});
