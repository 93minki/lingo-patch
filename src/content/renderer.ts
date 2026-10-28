import { strings } from '../ui/strings';
import {
  deserialize,
  findSegments,
  translationEqualsSource,
  type Segment,
} from '../core/segment';
export interface RenderRecord {
  key: string;
  segment: Segment;
  node?: HTMLElement;
  fontSize: string;
  lineHeight: string;
  abandoned: boolean;
  state?: 'pending' | 'ready' | 'error';
  text?: string;
}
export class SegmentRenderer {
  private marked = new Set<Element>();
  private srcNodes = new Set<Element>();
  private fontSizes = new WeakMap<Element, string>();
  private lineHeights = new WeakMap<Element, string>();
  private removals = new WeakMap<
    Element,
    { times: number[]; abandoned: boolean }
  >();
  constructor(private doc: Document) {}
  create(key: string, segment: Segment): RenderRecord {
    const style = this.doc.defaultView!.getComputedStyle(segment.block);
    const fontSize =
      style.fontSize === '0px'
        ? (this.fontSizes.get(segment.block) ?? '16px')
        : style.fontSize;
    const lineHeight =
      style.lineHeight === '0px'
        ? (this.lineHeights.get(segment.block) ?? 'normal')
        : style.lineHeight;
    this.fontSizes.set(segment.block, fontSize);
    this.lineHeights.set(segment.block, lineHeight);
    return {
      key,
      segment,
      fontSize,
      lineHeight,
      abandoned: this.removals.get(segment.block)?.abandoned ?? false,
    };
  }
  render(
    record: RenderRecord,
    state: 'pending' | 'ready' | 'error',
    text = '',
  ): void {
    if (
      record.abandoned ||
      this.removals.get(record.segment.block)?.abandoned ||
      !record.segment.block.isConnected
    )
      return;
    if (
      record.node?.isConnected &&
      record.state === state &&
      record.text === text
    )
      return;
    this.remove(record);
    if (
      state === 'ready' &&
      translationEqualsSource(text, record.segment.text)
    ) {
      record.node = undefined;
      record.state = state;
      record.text = text;
      return;
    }
    const node = this.doc.createElement('lp-t');
    node.dataset.lpKey = record.key;
    node.dataset.lpState = state;
    const style = this.doc.defaultView!.getComputedStyle(record.segment.block);
    const block =
      ['block', 'list-item', 'table-cell', 'flow-root'].includes(
        style.display,
      ) ||
      (style.display === 'flex' && style.flexDirection.startsWith('column'));
    node.dataset.lpDisplay = block ? 'block' : 'inline';
    node.style.setProperty('--lp-fs', record.fontSize || '16px');
    node.style.setProperty('--lp-lh', record.lineHeight || 'normal');
    if (state === 'ready') {
      const { fragment } = deserialize(
        text,
        record.segment.placeholders,
        this.doc,
      );
      // Clones of marked source elements must stay visible inside the translation.
      for (const clone of fragment.querySelectorAll('[data-lp-src]'))
        clone.removeAttribute('data-lp-src');
      node.append(fragment);
    }
    if (state === 'error') {
      node.textContent = '⚠';
      node.title = strings.progress.partialFailure;
    }
    const { block: parent, anchor } = record.segment;
    parent.insertBefore(node, anchor?.parentNode === parent ? anchor : null);
    if (state === 'ready') {
      if (!parent.hasAttribute('data-lp-src-hidden')) {
        parent.setAttribute('data-lp-src-hidden', '');
        this.marked.add(parent);
      }
      this.markSourceElements(record.segment);
    }
    record.node = node;
    record.state = state;
    record.text = text;
  }
  restore(record: RenderRecord, now = Date.now()): void {
    if (
      !record.node ||
      record.node.isConnected ||
      !record.segment.block.isConnected ||
      record.abandoned
    )
      return;
    const current = findSegments(record.segment.block).find(
      (segment) =>
        segment.block === record.segment.block &&
        segment.anchor === record.segment.anchor &&
        segment.markup === record.segment.markup,
    );
    if (!current) {
      this.remove(record);
      return;
    }
    record.segment = current;
    const block = record.segment.block;
    const history = this.removals.get(block) ?? { times: [], abandoned: false };
    this.removals.set(block, history);
    if (history.abandoned) {
      record.abandoned = true;
      this.remove(record);
      return;
    }
    history.times = history.times.filter((time) => now - time < 5000);
    history.times.push(now);
    if (history.times.length > 3) {
      history.abandoned = record.abandoned = true;
      this.remove(record);
      console.warn(
        'lingo-patch: page repeatedly removed a translation; skipping block',
      );
      return;
    }
    this.render(record, record.state ?? 'pending', record.text);
  }
  remove(record: RenderRecord): void {
    this.unmarkSourceElements(record.segment);
    record.node?.remove();
    const block = record.segment.block;
    if (
      this.marked.has(block) &&
      ![...block.children].some(
        (child) =>
          child.localName === 'lp-t' &&
          (child as HTMLElement).dataset.lpState === 'ready',
      )
    ) {
      block.removeAttribute('data-lp-src-hidden');
      this.marked.delete(block);
    }
  }
  clear(records: Iterable<RenderRecord>): void {
    for (const record of records) this.remove(record);
    for (const block of this.marked)
      block.removeAttribute('data-lp-src-hidden');
    this.marked.clear();
    for (const node of this.srcNodes) node.removeAttribute('data-lp-src');
    this.srcNodes.clear();
    this.removals = new WeakMap();
    this.fontSizes = new WeakMap();
    this.lineHeights = new WeakMap();
  }
  private markSourceElements(segment: Segment): void {
    for (const placeholder of segment.placeholders) {
      placeholder.node.setAttribute('data-lp-src', '');
      this.srcNodes.add(placeholder.node);
    }
  }
  private unmarkSourceElements(segment: Segment): void {
    for (const placeholder of segment.placeholders) {
      placeholder.node.removeAttribute('data-lp-src');
      this.srcNodes.delete(placeholder.node);
    }
  }
}
