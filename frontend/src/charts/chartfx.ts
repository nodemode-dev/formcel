import type { EngineClient } from '../engine';
import type { ErrBars, Trend } from './types';

const LIMIT = 4000;

export class Formats {
  private cache = new Map<string, string>();
  private want = new Map<string, Set<number>>();

  text(code: string | undefined, n: number, fallback: (n: number) => string): string {
    if (!code) return fallback(n);
    const hit = this.cache.get(`${code}\u0000${n}`);
    if (hit !== undefined) return hit;
    let set = this.want.get(code);
    if (!set) this.want.set(code, (set = new Set()));
    set.add(n);
    return fallback(n);
  }

  pending(): boolean {
    return this.want.size > 0;
  }

  async prime(eng: EngineClient): Promise<void> {
    const jobs = [...this.want];
    this.want = new Map();
    if (this.cache.size > LIMIT) this.cache.clear();
    await Promise.all(
      jobs.map(async ([code, set]) => {
        const nums = [...set];
        const out = await eng.formatNumbers(code, nums).catch(() => [] as string[]);
        nums.forEach((n, i) => this.cache.set(`${code}\u0000${n}`, out[i] ?? String(n)));
      }),
    );
  }
}

export const FORMATS = new Formats();

export interface Fit {
  at(x: number): number;
  eq: string;
  r2: number | null;
  line: [number, number][] | null;
}

function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return n.toExponential(2).replace(/\.?0+e/, 'e');
  return String(Math.round(n * 10000) / 10000);
}

function solve(m: number[][], v: number[]): number[] | null {
  const n = v.length;
  const a = m.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = a[r][c] / a[c][c];
      for (let j = c; j <= n; j++) a[r][j] -= k * a[c][j];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

function polyFit(xs: number[], ys: number[], order: number): number[] | null {
  const n = order + 1;
  const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => xs.reduce((s, x) => s + x ** (i + j), 0)));
  const v = Array.from({ length: n }, (_, i) => xs.reduce((s, x, k) => s + ys[k] * x ** i, 0));
  return solve(m, v);
}

function rsq(ys: number[], pred: number[]): number | null {
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const tot = ys.reduce((s, y) => s + (y - mean) ** 2, 0);
  if (tot === 0) return null;
  const res = ys.reduce((s, y, i) => s + (y - pred[i]) ** 2, 0);
  return Math.max(0, 1 - res / tot);
}

const SUP = ['', '', '²', '³', '⁴', '⁵', '⁶'];

export function fitTrend(t: Trend, xs: number[], ys: number[]): Fit | null {
  const pts = xs.map((x, i) => [x, ys[i]] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length < 2) return null;
  const X = pts.map((p) => p[0]);
  const Y = pts.map((p) => p[1]);
  if (t.kind === 'mavg') {
    const per = Math.max(2, Math.min(t.period ?? 2, pts.length));
    const line: [number, number][] = [];
    for (let i = per - 1; i < pts.length; i++) {
      let s = 0;
      for (let k = i - per + 1; k <= i; k++) s += Y[k];
      line.push([X[i], s / per]);
    }
    return line.length ? { at: () => NaN, eq: '', r2: null, line } : null;
  }
  if (t.kind === 'linear' || t.kind === 'poly') {
    const order = t.kind === 'linear' ? 1 : Math.max(2, Math.min(6, Math.round(t.order ?? 2)));
    if (pts.length <= order) return null;
    const c = polyFit(X, Y, order);
    if (!c) return null;
    const at = (x: number) => c.reduce((s, k, i) => s + k * x ** i, 0);
    const terms: string[] = [];
    for (let i = order; i >= 0; i--) {
      const k = c[i];
      const body = i === 0 ? num(Math.abs(k)) : `${Math.abs(k) === 1 ? '' : num(Math.abs(k))}x${i === 1 ? '' : SUP[i]}`;
      terms.push(`${terms.length ? (k < 0 ? ' - ' : ' + ') : k < 0 ? '-' : ''}${body}`);
    }
    return { at, eq: `y = ${terms.join('')}`, r2: rsq(Y, X.map(at)), line: null };
  }
  if (t.kind === 'log') {
    const keep = pts.filter(([x]) => x > 0);
    if (keep.length < 2) return null;
    const LX = keep.map((p) => Math.log(p[0]));
    const KY = keep.map((p) => p[1]);
    const c = polyFit(LX, KY, 1);
    if (!c) return null;
    return { at: (x) => c[0] + c[1] * Math.log(x), eq: `y = ${num(c[1])}ln(x) ${c[0] < 0 ? '-' : '+'} ${num(Math.abs(c[0]))}`, r2: rsq(KY, LX.map((x) => c[0] + c[1] * x)), line: null };
  }
  if (t.kind === 'exp') {
    const keep = pts.filter(([, y]) => y > 0);
    if (keep.length < 2) return null;
    const KX = keep.map((p) => p[0]);
    const LY = keep.map((p) => Math.log(p[1]));
    const c = polyFit(KX, LY, 1);
    if (!c) return null;
    const a = Math.exp(c[0]);
    return { at: (x) => a * Math.exp(c[1] * x), eq: `y = ${num(a)}e^${num(c[1])}x`, r2: rsq(LY, KX.map((x) => c[0] + c[1] * x)), line: null };
  }
  const keep = pts.filter(([x, y]) => x > 0 && y > 0);
  if (keep.length < 2) return null;
  const LX = keep.map((p) => Math.log(p[0]));
  const LY = keep.map((p) => Math.log(p[1]));
  const c = polyFit(LX, LY, 1);
  if (!c) return null;
  const a = Math.exp(c[0]);
  return { at: (x) => a * x ** c[1], eq: `y = ${num(a)}x^${num(c[1])}`, r2: rsq(LY, LX.map((x) => c[0] + c[1] * x)), line: null };
}

export function errAmount(e: ErrBars, y: number, all: number[]): [number, number] {
  let amt = e.value;
  if (e.kind === 'percent') amt = (Math.abs(y) * e.value) / 100;
  else if (e.kind === 'stdev' || e.kind === 'sterr') {
    const n = all.length;
    const mean = all.reduce((a, b) => a + b, 0) / (n || 1);
    const sd = n > 1 ? Math.sqrt(all.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
    amt = e.kind === 'stdev' ? sd * e.value : (sd / Math.sqrt(n || 1)) * e.value;
  }
  return [e.dir === 'plus' ? 0 : amt, e.dir === 'minus' ? 0 : amt];
}

export function applies(list: { series: number }[] | undefined, i: number): boolean {
  return !!list && list.some((t) => t.series === i || t.series < 0);
}
