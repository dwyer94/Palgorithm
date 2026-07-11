/** Generic binary min-heap, keyed by a comparator's numeric cost. Used by the masked
 * carrier-search Dijkstra (`speciesPlanner.ts`'s `solveMasked`), whose state space is large
 * enough that a linear-scan extract-min risks real slowdowns — unlike the plain species solver,
 * which stays small even on the real dataset. */
export class MinHeap<T> {
  private items: T[] = [];

  constructor(private readonly cost: (item: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.cost(items[parent]!) <= this.cost(items[i]!)) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < n && this.cost(items[left]!) < this.cost(items[smallest]!)) smallest = left;
        if (right < n && this.cost(items[right]!) < this.cost(items[smallest]!)) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top;
  }
}
