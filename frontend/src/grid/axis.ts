export interface AxisState {
  sizes: [number, number][];
  hidden: number[];
  levels?: [number, number][];
  folded?: [number, number][];
  base?: number;
  before?: boolean;
}

export interface OutlineRun {
  a: number;
  b: number;
  level: number;
}

export const MAX_LEVEL = 7;

export class Axis {
  private readonly sizes = new Map<number, number>();
  private readonly hidden = new Set<number>();
  private filtered = new Set<number>();
  private readonly levels = new Map<number, number>();
  private readonly folded = new Map<number, number>();
  private runCache: OutlineRun[] | null = null;
  private keys: number[] = [];
  private deltas: number[] = [];

  readonly home: number;
  before = false;

  summaryAt(r: OutlineRun): number {
    if (this.before) return r.a > 0 ? r.a - 1 : r.a;
    return r.b + 1 < this.count ? r.b + 1 : r.b;
  }

  clearOutline(): void {
    for (const i of this.levels.keys()) this.hidden.delete(i);
    this.levels.clear();
    this.folded.clear();
    this.runCache = null;
    this.rebuild();
  }

  constructor(
    readonly count: number,
    public base: number,
    readonly min = 4,
  ) {
    this.home = base;
  }

  setBase(px: number): void {
    this.base = Math.max(this.min, Math.min(800, Math.round(px)));
    for (const [k, v] of [...this.sizes]) if (v === this.base) this.sizes.delete(k);
    this.rebuild();
  }

  size(i: number): number {
    return this.hidden.has(i) || this.filtered.has(i) ? 0 : this.sizes.get(i) ?? this.base;
  }

  isHidden(i: number): boolean {
    return this.hidden.has(i);
  }

  isFiltered(i: number): boolean {
    return this.filtered.has(i);
  }

  private gone(i: number): boolean {
    return this.hidden.has(i) || this.filtered.has(i);
  }

  setFiltered(rows: Iterable<number>): void {
    this.filtered = new Set(rows);
    this.rebuild();
  }

  hasHidden(a: number, b: number): boolean {
    for (const h of this.hidden) if (h >= a && h <= b) return true;
    return false;
  }

  private rebuild(): void {
    this.keys = [...new Set([...this.sizes.keys(), ...this.hidden, ...this.filtered])].sort((a, b) => a - b);
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
    move(this.levels);
    move(this.folded);
    this.runCache = null;
    this.prune();
    this.rebuild();
  }

  state(): AxisState {
    const s: AxisState = { sizes: [...this.sizes.entries()], hidden: [...this.hidden] };
    if (this.levels.size) s.levels = [...this.levels.entries()];
    if (this.folded.size) s.folded = [...this.folded.entries()];
    if (this.base !== this.home) s.base = this.base;
    if (this.before) s.before = true;
    return s;
  }

  restore(s: AxisState | undefined): void {
    this.base = s?.base ?? this.home;
    this.before = !!s?.before;
    this.sizes.clear();
    this.hidden.clear();
    this.levels.clear();
    this.folded.clear();
    this.runCache = null;
    for (const [k, v] of s?.sizes ?? []) this.sizes.set(k, v);
    for (const k of s?.hidden ?? []) this.hidden.add(k);
    for (const [k, v] of s?.levels ?? []) this.levels.set(k, v);
    for (const [k, v] of s?.folded ?? []) this.folded.set(k, v);
    this.rebuild();
  }

  level(i: number): number {
    return this.levels.get(i) ?? 0;
  }

  maxLevel(): number {
    let m = 0;
    for (const l of this.levels.values()) if (l > m) m = l;
    return m;
  }

  group(a: number, b: number, d: 1 | -1): boolean {
    let changed = false;
    for (let i = a; i <= b; i++) {
      const l = this.level(i) + d;
      if (l < 0 || l > MAX_LEVEL) continue;
      if (l) this.levels.set(i, l);
      else this.levels.delete(i);
      changed = true;
    }
    this.runCache = null;
    this.prune();
    return changed;
  }

  runs(): OutlineRun[] {
    if (this.runCache) return this.runCache;
    const keys = [...this.levels.keys()].sort((x, y) => x - y);
    const out: OutlineRun[] = [];
    const max = this.maxLevel();
    for (let level = 1; level <= max; level++) {
      let a = -1;
      let prev = -2;
      for (const k of keys) {
        if (this.levels.get(k)! < level) continue;
        if (k !== prev + 1) {
          if (a >= 0) out.push({ a, b: prev, level });
          a = k;
        }
        prev = k;
      }
      if (a >= 0) out.push({ a, b: prev, level });
    }
    return (this.runCache = out);
  }

  isFolded(r: OutlineRun): boolean {
    return ((this.folded.get(r.b) ?? 0) & (1 << r.level)) !== 0;
  }

  fold(r: OutlineRun, on: boolean): void {
    const bit = 1 << r.level;
    const m = this.folded.get(r.b) ?? 0;
    const next = on ? m | bit : m & ~bit;
    if (next) this.folded.set(r.b, next);
    else this.folded.delete(r.b);
    if (on) {
      for (let i = r.a; i <= r.b; i++) this.hidden.add(i);
    } else {
      const inner = this.runs().filter((x) => x.level > r.level && x.a >= r.a && x.b <= r.b && this.isFolded(x));
      for (let i = r.a; i <= r.b; i++) if (!inner.some((x) => i >= x.a && i <= x.b)) this.hidden.delete(i);
    }
    this.rebuild();
  }

  showLevel(n: number): void {
    this.folded.clear();
    for (const [i, l] of this.levels) {
      if (l >= n) this.hidden.add(i);
      else this.hidden.delete(i);
    }
    for (const r of this.runs()) if (r.level >= n) this.folded.set(r.b, (this.folded.get(r.b) ?? 0) | (1 << r.level));
    this.rebuild();
  }

  private prune(): void {
    const live = new Map<number, number>();
    for (const r of this.runs()) live.set(r.b, (live.get(r.b) ?? 0) | (1 << r.level));
    for (const [b, m] of [...this.folded]) {
      const keep = m & (live.get(b) ?? 0);
      if (keep) this.folded.set(b, keep);
      else this.folded.delete(b);
    }
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
    while (this.gone(k) && k + dir >= 0 && k + dir < this.count) k += dir;
    if (this.gone(k)) {
      k = i;
      while (this.gone(k) && k - dir >= 0 && k - dir < this.count) k -= dir;
    }
    return k;
  }
}
