import { isBodyDirectSwap, nearestScanRoot } from './scan-block';

export const MAX_INCREMENTAL_ROOTS = 50;
export const BLOCK_RESCAN_MS = 1000;
export const INCREMENTAL_PAGE_MS = 5000;

export type PendingScan = {
  roots: Set<Element>;
  bodySwap: boolean;
};

export function createPendingScan(): PendingScan {
  return { roots: new Set(), bodySwap: false };
}

export function collectMutationRoots(
  changes: MutationRecord[],
  body: Element,
  pending: PendingScan,
): boolean {
  let sourceChanged = false;
  for (const change of changes) {
    const target =
      change.target.nodeType === 1
        ? (change.target as Element)
        : change.target.parentElement;
    if (target?.closest('lp-t')) continue;
    if (change.type === 'characterData') {
      sourceChanged = true;
      const root = nearestScanRoot(change.target, body);
      if (root) pending.roots.add(root);
      continue;
    }
    const structural = [...change.addedNodes, ...change.removedNodes].some(
      (node) => node.nodeType !== 1 || (node as Element).localName !== 'lp-t',
    );
    if (!structural) continue;
    sourceChanged = true;
    for (const node of change.addedNodes) {
      if (node.nodeType !== 1 || (node as Element).localName === 'lp-t')
        continue;
      if (isBodyDirectSwap(node)) pending.bodySwap = true;
      const root = nearestScanRoot(node, body);
      if (root) pending.roots.add(root);
    }
    // Removed nodes are detached; rescan from the parent they left.
    if (change.removedNodes.length) {
      const root = nearestScanRoot(change.target, body);
      if (root) pending.roots.add(root);
    }
  }
  return sourceChanged;
}

export function shouldFullScan(pending: PendingScan): boolean {
  if (pending.bodySwap) return true;
  return pending.roots.size > MAX_INCREMENTAL_ROOTS;
}

export function pickIncrementalRoots(
  roots: Iterable<Element>,
  lastScanAt: Map<Element, number>,
  now: number,
): { scan: Element[]; waitMs: number } {
  const scan: Element[] = [];
  let waitMs = BLOCK_RESCAN_MS;
  for (const root of roots) {
    if (!root.isConnected) continue;
    const last = lastScanAt.get(root) ?? 0;
    const elapsed = now - last;
    if (elapsed >= BLOCK_RESCAN_MS) scan.push(root);
    else waitMs = Math.min(waitMs, BLOCK_RESCAN_MS - elapsed);
  }
  return { scan, waitMs };
}
