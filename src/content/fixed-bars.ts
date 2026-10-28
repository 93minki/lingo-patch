export function createFixedBarFilter(
  doc: Document,
): (element: Element) => boolean {
  const cache = new WeakMap<Element, boolean>();
  return (element) => {
    let current: Element | null = element;
    const visited: Element[] = [];
    let excluded = false;
    while (current) {
      const known = cache.get(current);
      if (known !== undefined) {
        excluded = known;
        break;
      }
      visited.push(current);
      const position = doc.defaultView!.getComputedStyle(current).position;
      const height = current.getBoundingClientRect().height;
      if (
        (position === 'fixed' || position === 'sticky') &&
        height <= 120
      ) {
        excluded = true;
        break;
      }
      current = current.parentElement;
    }
    for (const node of visited) cache.set(node, excluded);
    return excluded;
  };
}
