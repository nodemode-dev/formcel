export interface AxisState {
  sizes: [number, number][];
  hidden: number[];
}

export class Axis {
  private readonly sizes = new Map<number, number>();
  private readonly hidden = new Set<number>();
  private keys: number[] = [];
  private deltas: number[] = [];

  constructor(
    readonly count: number,
    readonly base: number,
    readonly min = 4,
  ) {}

  size(i: number): number {
    return this.hidden.has(i) ? 0 : this.sizes.get(i) ?? this.base;
  }

  isHidden(i: number): boolean {
    return this.hidden.has(i);
  }

  hasHidden(a: number, b: number): boolean {
    for (const h of this.hidden) if (h >= a && h <= b) return true;
    return false;
  }

  private rebuild(): void {
    this.keys = [...new Set([...this.sizes.keys(), ...this.hidden])].sort((a, b) => a - b);
    let acc = 0;
    this.deltas = this.keys.map((k) => (acc += this.size(k) - this.base));
  }

  setSize(i: number, px: number): void {
    const v = Math.max(this.min, Math.round(px));
    if (v === this.base) this.sizes.delete(i);
    else this.sizes.set(i, v);
    this.hidden.delete(i);
    this.rebuild();
  }

  setHidden(a: number, b: number, on: boolean): void {
    for (let i = a; i <= b; i++) {
      if (on) this.hidden.add(i);
      else this.hidden.delete(i);
    }
    this.rebuild();
  }

  shift(at: number, delta: number): void {
    const move = (m: Map<number, number> | Set<number>) => {
      const items = m instanceof Map ? [...m.entries()] : [...m].map((k) => [k, 0] as [number, number]);
      m.clear();
      for (const [k, v] of items) {
        let n = k;
        if (delta > 0 && k >= at) n = k + delta;
        else if (delta < 0 && k >= at && k < at - delta) continue;
        else if (delta < 0 && k >= at - delta) n = k + delta;
        if (n >= this.count) continue;
        if (m instanceof Map) m.set(n, v);
        else m.add(n);
      }
    };
    move(this.sizes);
    move(this.hidden);
    this.rebuild();
  }

  state(): AxisState {
    return { sizes: [...this.sizes.entries()], hidden: [...this.hidden] };
  }

  restore(s: AxisState | undefined): void {
    this.sizes.clear();
    this.hidden.clear();
    for (const [k, v] of s?.sizes ?? []) this.sizes.set(k, v);
    for (const k of s?.hidden ?? []) this.hidden.add(k);
    this.rebuild();
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
    if (px <= 0) return this.nextVisible(0, 1);
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsetOf(mid) <= px) lo = mid;
      else hi = mid - 1;
    }
    return this.nextVisible(lo, 1);
  }

  nextVisible(i: number, dir: 1 | -1): number {
    let k = i;
    while (this.hidden.has(k) && k + dir >= 0 && k + dir < this.count) k += dir;
    if (this.hidden.has(k)) {
      k = i;
      while (this.hidden.has(k) && k - dir >= 0 && k - dir < this.count) k -= dir;
    }
    return k;
  }
}
