import { findSegments, type Segment } from '../core/segment';

export function findHoverSegment(
  target: Element,
  root: Element,
  targetLang: string,
): Segment | undefined {
  if (
    !root.contains(target) ||
    target.closest(
      'input,textarea,select,[contenteditable],lp-t,[data-lp-ignore]',
    )
  )
    return undefined;
  const segments = findSegments(root, { targetLang });
  for (
    let element: Element | null = target;
    element && root.contains(element);
    element = element.parentElement
  ) {
    const matches = segments.filter((segment) => segment.block === element);
    if (!matches.length) continue;
    return (
      matches.find(
        (segment) =>
          !segment.anchor ||
          Boolean(target.compareDocumentPosition(segment.anchor) & 4),
      ) ?? matches[0]
    );
  }
  return undefined;
}
