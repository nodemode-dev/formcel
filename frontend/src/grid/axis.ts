export class Axis {
  private readonly sizes = new Map<number, number>();
  private keys: number[] = [];
  private deltas: number[] = [];

  constructor(
    readonly count: number,
    readonly base: number,
    readonly min = 4,
  ) {}

  size(i: number): number {
    return this.sizes.get(i) ?? this.base;
  }

  setSize(i: number, px: number): void {
    const v = Math.max(this.min, Math.round(px));
    if (v === this.base) this.sizes.delete(i);
    else this.sizes.set(i, v);
    this.keys = [...this.sizes.keys()].sort((a, b) => a - b);
    let acc = 0;
    this.deltas = this.keys.map((k) => (acc += this.sizes.get(k)! - this.base));
  }

  offsetOf(i: number): number {
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return i * this.base + (lo > 0 ? this.deltas[lo - 1] : 0);
  }

  total(): number {
    return this.offsetOf(this.count);
  }

  indexAt(px: number): number {
    if (px <= 0) return 0;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsetOf(mid) <= px) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
