import { expect, test } from 'vitest';

test('provides a DOM environment', () => {
  const heading = document.createElement('h1');
  heading.textContent = 'lingo-patch';

  expect(heading.outerHTML).toBe('<h1>lingo-patch</h1>');
});
