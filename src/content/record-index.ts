import type { RenderRecord } from './renderer';

function removeFromList(list: RenderRecord[], record: RenderRecord): void {
  const index = list.indexOf(record);
  if (index >= 0) list.splice(index, 1);
}

export class RecordIndex {
  readonly records: RenderRecord[] = [];
  private byBlock = new Map<Element, RenderRecord[]>();
  private byKey = new Map<string, RenderRecord[]>();

  attach(record: RenderRecord): void {
    this.records.push(record);
    let blockList = this.byBlock.get(record.segment.block);
    if (!blockList) {
      blockList = [];
      this.byBlock.set(record.segment.block, blockList);
    }
    blockList.push(record);
    let keyList = this.byKey.get(record.key);
    if (!keyList) {
      keyList = [];
      this.byKey.set(record.key, keyList);
    }
    keyList.push(record);
  }

  detach(record: RenderRecord): void {
    removeFromList(this.records, record);
    const blockList = this.byBlock.get(record.segment.block);
    if (blockList) {
      removeFromList(blockList, record);
      if (!blockList.length) this.byBlock.delete(record.segment.block);
    }
    const keyList = this.byKey.get(record.key);
    if (keyList) {
      removeFromList(keyList, record);
      if (!keyList.length) this.byKey.delete(record.key);
    }
  }

  clear(): void {
    this.records.length = 0;
    this.byBlock.clear();
    this.byKey.clear();
  }

  replaceAll(next: RenderRecord[]): void {
    this.clear();
    for (const record of next) this.attach(record);
  }

  find(
    key: string,
    block: Element,
    anchor: Node | null,
  ): RenderRecord | undefined {
    for (const record of this.byBlock.get(block) ?? []) {
      if (record.key === key && record.segment.anchor === anchor) return record;
    }
    return undefined;
  }

  getByKey(key: string): RenderRecord[] {
    return this.byKey.get(key) ?? [];
  }

  getByBlock(block: Element): RenderRecord[] {
    return this.byBlock.get(block) ?? [];
  }

  *recordsInRegion(root: Element): Generator<RenderRecord> {
    for (const [block, list] of this.byBlock) {
      if (!block.isConnected) continue;
      if (block === root || root.contains(block)) yield* list;
    }
  }
}
