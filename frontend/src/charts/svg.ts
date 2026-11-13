import type { EngineClient } from '../engine';
import { annotatedTimeline, isAnnotated } from './annotated';
import { FORMATS, errAmount, fitTrend } from './chartfx';
import type { Kit } from './kit';
import { countryFor, ramp } from './map';
import { REGION_UNITS, bounds, center, loadMoreRegions, pathBox, planMap, regionsIn, type MapPlan } from './regionmap';
import type { Region } from './regions';
import { PALETTE, type ChartData, type ChartSpec, type Series } from './types';
import { WORLD, WORLD_H, WORLD_W } from './world';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const r1 = (n: number): string => String(Math.round(n * 10) / 10);
let COLORS: string[] | undefined;
const color = (i: number): string => {
  const c = COLORS?.[i];
  return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : PALETTE[i % PALETTE.length];
};
const shown = (code: string | undefined, n: number): string => FORMATS.text(code, n, fmt);

interface Axis {
  min: number;
  max: number;
  ticks: number[];
  log: boolean;
}

function frac(a: Axis, v: number): number {
  if (!a.log) return (v - a.min) / (a.max - a.min);
  const lo = Math.log10(a.min);
  return (Math.log10(Math.max(v, a.min)) - lo) / (Math.log10(a.max) - lo || 1);
}

function logAxis(lo: number, hi: number): Axis {
  const floor = Math.pow(10, Math.floor(Math.log10(Math.max(lo, 1e-9))));
  const ceil = Math.pow(10, Math.ceil(Math.log10(Math.max(hi, floor * 10))));
  const ticks: number[] = [];
  for (let v = floor; v <= ceil * 1.0001; v *= 10) ticks.push(v);
  return { min: floor, max: ceil, ticks, log: true };
}

export function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${fmt(n / 1e9)}B`;
  if (a >= 1e6) return `${fmt(n / 1e6)}M`;
  if (a >= 1e4) return `${fmt(n / 1e3)}K`;
  return String(Math.round(n * 100) / 100);
}

function serial(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.toISOString().slice(0, 10);
}

function nice(lo: number, hi: number, count = 5): { min: number; max: number; ticks: number[] } {
  if (!(hi > lo)) {
    hi = lo + 1;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { min, max, ticks };
}

const text = (x: number, y: number, s: string, o: { size?: number; anchor?: string; bold?: boolean; rot?: number; fill?: string; base?: string; op?: number; halo?: string } = {}): string =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${o.size ?? 11}" text-anchor="${o.anchor ?? 'middle'}"${o.base ? ` dominant-baseline="${o.base}"` : ''}${o.bold ? ' font-weight="600"' : ''}${o.halo ? ` stroke="${o.halo}" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke"` : ''} fill="${o.fill ?? 'currentColor'}"${o.op ? ` fill-opacity="${o.op}"` : ''}${o.rot ? ` transform="rotate(${o.rot} ${r1(x)} ${r1(y)})"` : ''}>${esc(s)}</text>`;

const line = (x1: number, y1: number, x2: number, y2: number, o = 'stroke-opacity="0.15"', w = 1): string =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="currentColor" ${o} stroke-width="${w}"/>`;

function errV(x: number, c: number, a: number, b: number): string {
  const cap = (y: number) => (Math.abs(y - c) > 0.01 ? line(x - 4, y, x + 4, y, 'stroke-opacity="0.85"', 1.25) : '');
  return line(x, a, x, b, 'stroke-opacity="0.85"', 1.25) + cap(a) + cap(b);
}

function errH(y: number, c: number, a: number, b: number): string {
  const cap = (x: number) => (Math.abs(x - c) > 0.01 ? line(x, y - 4, x, y + 4, 'stroke-opacity="0.85"', 1.25) : '');
  return line(a, y, b, y, 'stroke-opacity="0.85"', 1.25) + cap(a) + cap(b);
}

function trendSvg(out: string[], spec: ChartSpec, d: ChartData, kind: 'cat' | 'xy', xs: number[][], px: (x: number, i: number) => number, py: (y: number, i: number) => number, plot: Box): void {
  let note = 0;
  for (const t of spec.trends ?? []) {
    d.series.forEach((s, i) => {
      if (t.series !== i && t.series >= 0) return;
      if (kind === 'xy' && spec.type === 'bubble' && i > 0) return;
      const X = xs[i] ?? xs[0];
      const pairs = X.map((x, k) => [x, s.vals[k]] as const).filter((q): q is readonly [number, number] => num(q[1]) && Number.isFinite(q[0]));
      const fit = fitTrend(t, pairs.map((q) => q[0]), pairs.map((q) => q[1]));
      if (!fit) return;
      const col = color(i);
      if (fit.line) {
        out.push(`<path d="${fit.line.map(([x, y], k) => `${k ? 'L' : 'M'}${r1(px(x, i))} ${r1(py(y, i))}`).join('')}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>`);
        return;
      }
      const lo = Math.min(...pairs.map((q) => q[0]));
      const hi = Math.max(...pairs.map((q) => q[0]));
      const steps = 48;
      const pts: string[] = [];
      for (let k = 0; k <= steps; k++) {
        const x = lo + ((hi - lo) * k) / steps;
        const y = fit.at(x);
        if (Number.isFinite(y)) pts.push(`${pts.length ? 'L' : 'M'}${r1(px(x, i))} ${r1(py(y, i))}`);
      }
      out.push(`<path d="${pts.join('')}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>`);
      const lines = [t.eq ? fit.eq : '', t.r2 && fit.r2 !== null ? `R² = ${Math.round(fit.r2 * 10000) / 10000}` : ''].filter(Boolean);
      lines.forEach((s2) => {
        out.push(text(plot.x + plot.w - 6, plot.y + 14 + note * 14, s2, { anchor: 'end', size: 10, fill: col }));
        note++;
      });
    });
  }
}

function arc(cx: number, cy: number, r0: number, r: number, a0: number, a1: number): string {
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  const b1 = full ? a0 + Math.PI * 2 - 1e-4 : a1;
  const p = (rad: number, a: number) => `${r1(cx + rad * Math.cos(a))} ${r1(cy + rad * Math.sin(a))}`;
  const big = b1 - a0 > Math.PI ? 1 : 0;
  if (r0 <= 0) return `M${cx} ${cy}L${p(r, a0)}A${r} ${r} 0 ${big} 1 ${p(r, b1)}Z`;
  return `M${p(r, a0)}A${r} ${r} 0 ${big} 1 ${p(r, b1)}L${p(r0, b1)}A${r0} ${r0} 0 ${big} 0 ${p(r0, a0)}Z`;
}

function quant(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (pos - lo);
}

const num = (v: number | null): v is number => v !== null && Number.isFinite(v);

function ellipsis(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

type Gen = (spec: ChartSpec, d: ChartData, b: Box) => string;

function legendItems(spec: ChartSpec, d: ChartData): string[] {
  const t = spec.type;
  if (['pie', 'doughnut', 'funnel', 'treemap', 'sunburst'].includes(t)) return d.cats;
  if (['histogram', 'waterfall', 'gauge', 'scorecard', 'org', 'timeline', 'box', 'map'].includes(t)) return [];
  if (t === 'candlestick') return [];
  if (t === 'radar' || d.series.length > 1) return d.series.map((s) => s.name);
  return [];
}

export function renderChart(spec: ChartSpec, d: ChartData, w: number, h: number): string {
  w = Math.max(60, Math.round(w));
  h = Math.max(40, Math.round(h));
  const src = (spec.errBars ?? []).find((e) => e.kind === 'column');
  if (src && d.series[src.value]) {
    const ext = d.series[src.value].vals;
    d = { ...d, series: d.series.filter((_, i) => i !== src.value) };
    spec = { ...spec, errBars: spec.errBars!.map((e) => (e.kind === 'column' ? { ...e, ext } : e)) };
  }
  const parts: string[] = [];
  COLORS = spec.colors;
  if (spec.fill) parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${esc(spec.fill)}"/>`);
  let top = 8;
  let bottom = h - 8;
  let left = 8;
  let right = w - 8;
  if (spec.title) {
    parts.push(text(w / 2, 20, ellipsis(spec.title, Math.floor(w / 8)), { size: 14, bold: true }));
    top = 34;
  }
  const items = spec.legend === 'none' ? [] : legendItems(spec, d);
  if (items.length) {
    const horizontal = spec.legend === 'top' || spec.legend === 'bottom';
    if (horizontal) {
      let x = 0;
      const widths = items.map((s) => Math.min(120, s.length * 6.2 + 26));
      const rows: number[][] = [[]];
      let rowW = 0;
      widths.forEach((wd, i) => {
        if (rowW + wd > w - 16 && rows[rows.length - 1].length) {
          rows.push([]);
          rowW = 0;
        }
        rows[rows.length - 1].push(i);
        rowW += wd;
      });
      const bandH = rows.length * 18 + 4;
      const y0 = spec.legend === 'top' ? top : bottom - bandH + 4;
      rows.forEach((row, ri) => {
        const tw = row.reduce((a, i) => a + widths[i], 0);
        x = (w - tw) / 2;
        for (const i of row) {
          const yy = y0 + ri * 18 + 10;
          parts.push(`<rect x="${r1(x)}" y="${r1(yy - 5)}" width="10" height="10" rx="2" fill="${color(i)}"/>${text(x + 14, yy, ellipsis(items[i], 18), { anchor: 'start', base: 'central', size: 11 })}`);
          x += widths[i];
        }
      });
      if (spec.legend === 'top') top += bandH;
      else bottom -= bandH;
    } else {
      const lw = Math.min(140, Math.max(...items.map((s) => s.length)) * 6.2 + 28);
      const shown = items.slice(0, Math.max(1, Math.floor((bottom - top) / 18)));
      const x0 = spec.legend === 'left' ? left : right - lw + 8;
      const y0 = (top + bottom) / 2 - (shown.length * 18) / 2;
      shown.forEach((s, i) => {
        parts.push(`<rect x="${r1(x0)}" y="${r1(y0 + i * 18 + 2)}" width="10" height="10" rx="2" fill="${color(i)}"/>${text(x0 + 14, y0 + i * 18 + 8, ellipsis(s, 20), { anchor: 'start', base: 'central', size: 11 })}`);
      });
      if (spec.legend === 'left') left += lw;
      else right -= lw;
    }
  }
  const box: Box = { x: left, y: top, w: Math.max(20, right - left), h: Math.max(20, bottom - top) };
  const gen = GENERATORS[spec.type] ?? cartesian;
  const empty = !d.series.length || (!d.series.some((s) => s.vals.some(num)) && !['org', 'timeline'].includes(spec.type));
  const body = empty ? text(w / 2, h / 2, 'No numbers in the chart data range', { op: 0.6 }) : gen(spec, d, box);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(spec.title || spec.type)}" font-family="${chartFace ? `&quot;${esc(chartFace)}&quot;, ` : ''}Inter, system-ui, -apple-system, 'Segoe UI', sans-serif">${parts.join('')}${body}</svg>`;
}

let chartFace = '';

export function setChartFont(name: string): void {
  chartFace = name;
}

export async function renderChartAsync(eng: EngineClient, spec: ChartSpec, d: ChartData, w: number, h: number): Promise<string> {
  if (spec.type === 'map' && spec.level !== 'country') await loadMoreRegions();
  let html = renderChart(spec, d, w, h);
  if (FORMATS.pending()) {
    await FORMATS.prime(eng);
    html = renderChart(spec, d, w, h);
  }
  return html;
}

function labelWidth(ticks: string[]): number {
  return Math.max(...ticks.map((t) => t.length)) * 6.4 + 10;
}

function percentOf(d: ChartData): ChartData {
  const totals = d.cats.map((_, k) => d.series.reduce((a, s) => a + (num(s.vals[k]) ? Math.abs(s.vals[k] as number) : 0), 0));
  return { ...d, series: d.series.map((s) => ({ ...s, vals: s.vals.map((v, k) => (num(v) ? (totals[k] ? (v / totals[k]) * 100 : 0) : null)) })) };
}

function cartesian(spec: ChartSpec, d0: ChartData, b: Box): string {
  const t = spec.type;
  const pct = t.endsWith('-100');
  const d = pct ? percentOf(d0) : d0;
  const horizontal = t.startsWith('bar');
  const stacked = t.endsWith('-stacked') || pct;
  const area = t.startsWith('area');
  const isLine = t === 'line' || area;
  const combo = t === 'combo';
  const n = d.cats.length;
  const secIdx = new Set(combo ? (spec.secondary.length ? spec.secondary : d.series.length > 1 ? [d.series.length - 1] : []) : []);
  const left = d.series.map((s, i) => ({ s, i })).filter(({ i }) => !secIdx.has(i));
  const sec = d.series.map((s, i) => ({ s, i })).filter(({ i }) => secIdx.has(i));
  const range = (list: { s: Series; i: number }[], stack: boolean, zero: boolean): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    if (stack) {
      for (let k = 0; k < n; k++) {
        let pos = 0;
        let neg = 0;
        for (const { s } of list) {
          const v = s.vals[k];
          if (num(v)) v >= 0 ? (pos += v) : (neg += v);
        }
        lo = Math.min(lo, neg);
        hi = Math.max(hi, pos);
      }
    } else {
      for (const { s, i } of list) {
        const eb = (spec.errBars ?? []).find((e) => e.series === i || e.series < 0);
        const all = eb ? s.vals.filter(num) : [];
        for (const [k, v] of s.vals.entries()) {
          if (!num(v) || (spec.logY && v <= 0)) continue;
          const [dn, up] = eb ? errAmount(eb, v, all, k) : [0, 0];
          lo = Math.min(lo, v - dn);
          hi = Math.max(hi, v + up);
        }
      }
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (zero && !spec.logY) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (spec.min !== undefined) lo = spec.min;
    if (spec.max !== undefined) hi = spec.max;
    return [lo, hi];
  };
  const zero = !(isLine && !area);
  const [lo, hi] = range(left, stacked, zero || combo);
  const linear = (r: [number, number]): Axis => ({ ...nice(r[0], r[1]), log: false });
  const scale: Axis = spec.logY && !stacked ? logAxis(lo, hi) : linear([lo, hi]);
  const tickText = scale.ticks.map((v) => (pct && !spec.yFmt ? `${fmt(v)}%` : shown(spec.yFmt, v)));
  const sscale = sec.length ? linear(range(sec, false, false)) : null;
  const catLabels = d.cats.map((c, k) => ellipsis(spec.xFmt && num(d.catNums[k]) ? shown(spec.xFmt, d.catNums[k] as number) : c, 14));
  const lw = horizontal ? Math.min(100, labelWidth(catLabels)) : labelWidth(tickText);
  const rw = sscale ? labelWidth(sscale.ticks.map((v) => shown(spec.y2Fmt ?? spec.yFmt, v))) : 0;
  const padL = lw + (spec.yTitle ? 18 : 0);
  const tilted = !horizontal && (b.w - padL - rw - 6) / Math.max(1, n) < 46 && Math.max(...catLabels.map((c) => c.length)) > 4;
  const padB = (horizontal ? labelWidth(tickText) * 0 + 22 : 22) + (spec.xTitle ? 18 : 0) + (tilted ? 26 : 0);
  const p: Box = { x: b.x + padL, y: b.y + 6, w: Math.max(10, b.w - padL - rw - 6), h: Math.max(10, b.h - padB - 6) };
  const out: string[] = [];
  if (spec.plotFill) out.push(`<rect x="${r1(p.x)}" y="${r1(p.y)}" width="${r1(p.w)}" height="${r1(p.h)}" fill="${esc(spec.plotFill)}"/>`);
  const toPx = (v: number) => (horizontal ? p.x + frac(scale, v) * p.w : p.y + p.h - frac(scale, v) * p.h);
  const toSec = (v: number) => p.y + p.h - frac(sscale!, v) * p.h;
  const gridOn = spec.grid !== false;
  scale.ticks.forEach((v, i) => {
    const q = toPx(v);
    if (horizontal) out.push(gridOn ? line(q, p.y, q, p.y + p.h) : '', text(q, p.y + p.h + 14, tickText[i]));
    else out.push(gridOn ? line(p.x, q, p.x + p.w, q) : '', text(p.x - 6, q, tickText[i], { anchor: 'end', base: 'central' }));
  });
  if (sscale) sscale.ticks.forEach((v) => out.push(text(p.x + p.w + 6, toSec(v), shown(spec.y2Fmt ?? spec.yFmt, v), { anchor: 'start', base: 'central' })));
  const band = (horizontal ? p.h : p.w) / Math.max(1, n);
  if (spec.xGrid) for (let k = 0; k <= n; k++) out.push(horizontal ? line(p.x, p.y + band * k, p.x + p.w, p.y + band * k) : line(p.x + band * k, p.y, p.x + band * k, p.y + p.h));
  const every = Math.max(1, Math.ceil((n * (horizontal ? 14 : 62)) / (horizontal ? p.h : p.w)));
  const rotate = !horizontal && band < 46 && Math.max(...catLabels.map((c) => c.length)) > 4;
  d.cats.forEach((_, k) => {
    if (k % every) return;
    const c = (horizontal ? p.y : p.x) + band * (k + 0.5);
    if (horizontal) out.push(text(p.x - 6, c, catLabels[k], { anchor: 'end', base: 'central' }));
    else if (rotate) out.push(text(p.x + c - p.x + 4, p.y + p.h + 12, catLabels[k], { anchor: 'end', rot: -40 }));
    else out.push(text(c, p.y + p.h + 15, catLabels[k]));
  });
  const baseV = toPx(Math.max(scale.min, Math.min(scale.max, 0)));
  out.push(line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, 'stroke-opacity="0.4"'), line(p.x, p.y, p.x, p.y + p.h, 'stroke-opacity="0.4"'));
  const stackPos = new Array<number>(n).fill(0);
  const stackNeg = new Array<number>(n).fill(0);
  const colSeries = combo ? left : d.series.map((s, i) => ({ s, i }));
  const showCols = !isLine;
  const per = stacked ? 1 : Math.max(1, colSeries.length);
  const gw = band * 0.72;
  const bw = gw / per;
  if (showCols) {
    colSeries.forEach(({ s, i }, si) => {
      s.vals.forEach((v, k) => {
        if (!num(v)) return;
        const c = (horizontal ? p.y : p.x) + band * (k + 0.5) - gw / 2 + (stacked ? 0 : si * bw);
        let a = baseV;
        let z = toPx(v);
        if (stacked) {
          const prev = v >= 0 ? stackPos[k] : stackNeg[k];
          a = toPx(prev);
          z = toPx(prev + v);
          if (v >= 0) stackPos[k] += v;
          else stackNeg[k] += v;
        }
        const lo2 = Math.min(a, z);
        const len = Math.max(0.5, Math.abs(z - a));
        out.push(horizontal ? `<rect x="${r1(lo2)}" y="${r1(c)}" width="${r1(len)}" height="${r1(bw)}" fill="${color(i)}"/>` : `<rect x="${r1(c)}" y="${r1(lo2)}" width="${r1(bw)}" height="${r1(len)}" fill="${color(i)}"/>`);
        if (spec.labels) out.push(horizontal ? text(Math.max(a, z) + 3, c + bw / 2, shown(spec.labelFmt, v), { anchor: 'start', base: 'central', size: 10 }) : text(c + bw / 2, lo2 - 3, shown(spec.labelFmt, v), { size: 10 }));
        const eb = stacked ? undefined : (spec.errBars ?? []).find((e) => e.series === i || e.series < 0);
        if (eb) {
          const [dn, up] = errAmount(eb, v, s.vals.filter(num), k);
          const m = c + bw / 2;
          const hi2 = toPx(v + up);
          const lo3 = toPx(v - dn);
          out.push(horizontal ? errH(m, toPx(v), lo3, hi2) : errV(m, toPx(v), lo3, hi2));
        }
      });
    });
  }
  const lineSeries = isLine ? d.series.map((s, i) => ({ s, i })) : sec;
  const cum = new Array<number>(n).fill(0);
  lineSeries.forEach(({ s, i }) => {
    const pts: [number, number, number][] = [];
    const lower: [number, number][] = [];
    s.vals.forEach((v, k) => {
      if (!num(v)) return;
      const x = p.x + band * (k + 0.5);
      const below = area && stacked ? cum[k] : 0;
      if (area && stacked) cum[k] += v;
      pts.push([x, secIdx.has(i) && sscale ? toSec(v) : toPx(area && stacked ? cum[k] : v), v]);
      lower.push([x, area && stacked ? toPx(below) : baseV]);
    });
    if (!pts.length) return;
    const path = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('');
    if (area) out.push(`<path d="${path}${lower.reverse().map(([x, y]) => `L${r1(x)} ${r1(y)}`).join('')}Z" fill="${color(i)}" fill-opacity="${stacked ? 0.7 : 0.35}"/>`);
    out.push(`<path d="${path}" fill="none" stroke="${color(i)}" stroke-width="2" stroke-linejoin="round"/>`);
    const eb = stacked ? undefined : (spec.errBars ?? []).find((e) => e.series === i || e.series < 0);
    const yOf = (v: number) => (secIdx.has(i) && sscale ? toSec(v) : toPx(v));
    const all = eb ? s.vals.filter(num) : [];
    for (const [x, y, v] of pts) {
      if (eb) {
        const [dn, up] = errAmount(eb, v, all);
        out.push(errV(x, y, yOf(v - dn), yOf(v + up)));
      }
      out.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="3" fill="${color(i)}"/>`);
      if (spec.labels) out.push(text(x, y - 7, shown(spec.labelFmt, v), { size: 10 }));
    }
  });
  if (spec.trends?.length && !horizontal && !stacked) {
    const xs = [d.cats.map((_, k) => k + 1)];
    trendSvg(out, spec, d, 'cat', xs, (x) => p.x + band * (x - 0.5), (y, i) => (secIdx.has(i) && sscale ? toSec(y) : toPx(y)), p);
  }
  if (spec.xTitle) out.push(text(p.x + p.w / 2, b.y + b.h - 4, spec.xTitle, { size: 11, op: 0.8 }));
  if (spec.yTitle) out.push(text(b.x + 8, p.y + p.h / 2, spec.yTitle, { size: 11, rot: -90, op: 0.8 }));
  return out.join('');
}

function xy(spec: ChartSpec, d: ChartData, b: Box): string {
  const bubble = spec.type === 'bubble';
  const ys = bubble ? d.series.slice(0, 1) : d.series;
  const xs = d.catNums.map((v, i) => (num(v) ? v : i + 1));
  const xpad = bubble ? (Math.max(...xs) - Math.min(...xs) || 1) * 0.12 : 0;
  const xr = nice(Math.min(...xs) - xpad, Math.max(...xs) + xpad);
  const all = ys.flatMap((s) => s.vals).filter(num);
  let ylo = Math.min(...all);
  let yhi = Math.max(...all);
  ys.forEach((s, i) => {
    const eb = (spec.errBars ?? []).find((e) => e.series === i || e.series < 0);
    if (!eb) return;
    for (const v of s.vals.filter(num)) {
      const [dn, up] = errAmount(eb, v, all);
      ylo = Math.min(ylo, v - dn);
      yhi = Math.max(yhi, v + up);
    }
  });
  if (bubble) {
    const yp = (yhi - ylo || 1) * 0.12;
    ylo -= yp;
    yhi += yp;
  }
  if (spec.min !== undefined) ylo = spec.min;
  if (spec.max !== undefined) yhi = spec.max;
  const yr: Axis = spec.logY ? logAxis(Math.min(...all.filter((v) => v > 0), yhi), yhi) : { ...nice(ylo, yhi), log: false };
  const lw = labelWidth(yr.ticks.map((v) => shown(spec.yFmt, v))) + (spec.yTitle ? 18 : 0);
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 10), h: Math.max(10, b.h - 28 - (spec.xTitle ? 18 : 0)) };
  const px = (v: number) => p.x + ((v - xr.min) / (xr.max - xr.min)) * p.w;
  const py = (v: number) => p.y + p.h - frac(yr, v) * p.h;
  const out: string[] = [];
  if (spec.plotFill) out.push(`<rect x="${r1(p.x)}" y="${r1(p.y)}" width="${r1(p.w)}" height="${r1(p.h)}" fill="${esc(spec.plotFill)}"/>`);
  const gridOn = spec.grid !== false;
  yr.ticks.forEach((v) => out.push(gridOn ? line(p.x, py(v), p.x + p.w, py(v)) : '', text(p.x - 6, py(v), shown(spec.yFmt, v), { anchor: 'end', base: 'central' })));
  xr.ticks.forEach((v) => out.push(gridOn || spec.xGrid ? line(px(v), p.y, px(v), p.y + p.h) : '', text(px(v), p.y + p.h + 14, shown(spec.xFmt, v))));
  out.push(line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, 'stroke-opacity="0.4"'), line(p.x, p.y, p.x, p.y + p.h, 'stroke-opacity="0.4"'));
  for (const rf of spec.refs ?? []) {
    const v = Number(rf.at);
    if (!Number.isFinite(v)) continue;
    const vertical = rf.axis === 'x';
    if (v < (vertical ? xr.min : yr.min) || v > (vertical ? xr.max : yr.max)) continue;
    const q = vertical ? px(v) : py(v);
    out.push(vertical ? line(q, p.y, q, p.y + p.h, 'stroke-opacity="0.7" stroke-dasharray="6 4"', 1.5) : line(p.x, q, p.x + p.w, q, 'stroke-opacity="0.7" stroke-dasharray="6 4"', 1.5));
    if (rf.label) out.push(vertical ? text(q + 4, p.y + 10, rf.label, { size: 10, anchor: 'start', op: 0.8 }) : text(p.x + p.w - 4, q - 6, rf.label, { size: 10, anchor: 'end', op: 0.8 }));
  }
  const sizes = bubble && d.series[1] ? d.series[1].vals : [];
  const maxSize = Math.max(1, ...sizes.filter(num));
  ys.forEach((s, i) => {
    const eb = (spec.errBars ?? []).find((e) => e.series === i || e.series < 0);
    const own = eb ? s.vals.filter(num) : [];
    s.vals.forEach((v, k) => {
      if (!num(v)) return;
      const r = bubble ? 5 + 20 * Math.sqrt(Math.max(0, sizes[k] ?? 0) / maxSize) : 4;
      if (eb) {
        const [dn, up] = errAmount(eb, v, own);
        out.push(errV(px(xs[k]), py(v), py(v - dn), py(v + up)));
      }
      out.push(`<circle cx="${r1(px(xs[k]))}" cy="${r1(py(v))}" r="${r1(r)}" fill="${color(i)}" fill-opacity="${bubble ? 0.55 : 0.85}"/>`);
      if (spec.labels) out.push(text(px(xs[k]), py(v) - r - 3, shown(spec.labelFmt, v), { size: 10 }));
    });
  });
  if (spec.trends?.length) trendSvg(out, spec, { ...d, series: ys }, 'xy', [xs], px, (y) => py(y), p);
  if (spec.xTitle) out.push(text(p.x + p.w / 2, b.y + b.h - 4, spec.xTitle, { size: 11, op: 0.8 }));
  if (spec.yTitle) out.push(text(b.x + 8, p.y + p.h / 2, spec.yTitle, { size: 11, rot: -90, op: 0.8 }));
  return out.join('');
}

function pie(spec: ChartSpec, d: ChartData, b: Box): string {
  const s = d.series[0];
  const vals = s.vals.map((v) => (num(v) && v > 0 ? v : 0));
  const total = vals.reduce((a, v) => a + v, 0) || 1;
  const r = Math.max(10, Math.min(b.w, b.h) / 2 - 14);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const hole = spec.type === 'doughnut' ? r * 0.55 : 0;
  const out: string[] = [];
  let a = -Math.PI / 2;
  vals.forEach((v, i) => {
    if (!v) return;
    const sweep = (v / total) * Math.PI * 2;
    out.push(`<path d="${arc(cx, cy, hole, r, a, a + sweep)}" fill="${color(i)}" stroke="var(--cell-bg, #fff)" stroke-width="1.5"/>`);
    if (spec.labels && sweep > 0.15) {
      const mid = a + sweep / 2;
      const rr = hole ? (r + hole) / 2 : r * 0.65;
      out.push(text(cx + rr * Math.cos(mid), cy + rr * Math.sin(mid), `${Math.round((v / total) * 100)}%`, { size: 11, fill: '#fff', base: 'central', bold: true }));
    }
    a += sweep;
  });
  return out.join('');
}

function histogram(spec: ChartSpec, d: ChartData, b: Box): string {
  const v = d.series[0].vals.filter(num);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const bins = spec.bins && spec.bins > 0 ? Math.min(100, Math.round(spec.bins)) : Math.max(1, Math.min(30, Math.ceil(Math.log2(v.length) + 1)));
  const sc = nice(lo, hi, bins);
  const width = (sc.max - sc.min) / Math.max(1, sc.ticks.length - 1);
  const nb = Math.max(1, Math.round((sc.max - sc.min) / width));
  const counts = new Array<number>(nb).fill(0);
  for (const x of v) counts[Math.min(nb - 1, Math.floor((x - sc.min) / width))]++;
  const ys = nice(0, Math.max(...counts));
  const lw = labelWidth(ys.ticks.map(fmt)) + (spec.yTitle ? 18 : 0);
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 10), h: Math.max(10, b.h - 28 - (spec.xTitle ? 18 : 0)) };
  const out: string[] = [];
  ys.ticks.forEach((t) => {
    const y = p.y + p.h - (t / ys.max) * p.h;
    out.push(line(p.x, y, p.x + p.w, y), text(p.x - 6, y, fmt(t), { anchor: 'end', base: 'central' }));
  });
  const bw = p.w / nb;
  counts.forEach((c, i) => {
    const hh = (c / ys.max) * p.h;
    out.push(`<rect x="${r1(p.x + i * bw + 1)}" y="${r1(p.y + p.h - hh)}" width="${r1(bw - 2)}" height="${r1(hh)}" fill="${color(0)}"/>`);
    if (spec.labels && c) out.push(text(p.x + (i + 0.5) * bw, p.y + p.h - hh - 3, String(c), { size: 10 }));
  });
  for (let i = 0; i <= nb; i += Math.max(1, Math.ceil(nb / 8))) out.push(text(p.x + i * bw, p.y + p.h + 14, fmt(sc.min + i * width)));
  out.push(line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, 'stroke-opacity="0.4"'));
  if (spec.xTitle) out.push(text(p.x + p.w / 2, b.y + b.h - 4, spec.xTitle, { size: 11, op: 0.8 }));
  if (spec.yTitle) out.push(text(b.x + 8, p.y + p.h / 2, spec.yTitle, { size: 11, rot: -90, op: 0.8 }));
  return out.join('');
}

function box(spec: ChartSpec, d: ChartData, b: Box): string {
  const stats = d.series.map((s) => {
    const v = s.vals.filter(num).sort((a, c) => a - c);
    if (!v.length) return null;
    const q1 = quant(v, 0.25);
    const q3 = quant(v, 0.75);
    const iqr = q3 - q1;
    const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
    return { q1, q2: quant(v, 0.5), q3, lo: inside[0], hi: inside[inside.length - 1], out: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr) };
  });
  const all = stats.flatMap((s) => (s ? [s.lo, s.hi, ...s.out] : []));
  const sc = nice(Math.min(...all), Math.max(...all));
  const lw = labelWidth(sc.ticks.map(fmt)) + (spec.yTitle ? 18 : 0);
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 10), h: Math.max(10, b.h - 28 - (spec.xTitle ? 18 : 0)) };
  const py = (v: number) => p.y + p.h - ((v - sc.min) / (sc.max - sc.min)) * p.h;
  const out: string[] = [];
  sc.ticks.forEach((t) => out.push(line(p.x, py(t), p.x + p.w, py(t)), text(p.x - 6, py(t), fmt(t), { anchor: 'end', base: 'central' })));
  const band = p.w / d.series.length;
  stats.forEach((s, i) => {
    if (!s) return;
    const c = p.x + band * (i + 0.5);
    const bw = Math.min(60, band * 0.5);
    out.push(line(c, py(s.lo), c, py(s.hi), 'stroke-opacity="0.8"', 1.5));
    out.push(line(c - bw / 4, py(s.lo), c + bw / 4, py(s.lo), 'stroke-opacity="0.8"', 1.5), line(c - bw / 4, py(s.hi), c + bw / 4, py(s.hi), 'stroke-opacity="0.8"', 1.5));
    out.push(`<rect x="${r1(c - bw / 2)}" y="${r1(py(s.q3))}" width="${r1(bw)}" height="${r1(Math.max(1, py(s.q1) - py(s.q3)))}" fill="${color(i)}" fill-opacity="0.6" stroke="${color(i)}" stroke-width="1.5"/>`);
    out.push(line(c - bw / 2, py(s.q2), c + bw / 2, py(s.q2), 'stroke-opacity="0.95"', 2));
    for (const o of s.out) out.push(`<circle cx="${r1(c)}" cy="${r1(py(o))}" r="3" fill="none" stroke="currentColor" stroke-opacity="0.7"/>`);
    out.push(text(c, p.y + p.h + 14, ellipsis(d.series[i].name, 12)));
  });
  out.push(line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, 'stroke-opacity="0.4"'));
  if (spec.yTitle) out.push(text(b.x + 8, p.y + p.h / 2, spec.yTitle, { size: 11, rot: -90, op: 0.8 }));
  return out.join('');
}

function waterfall(spec: ChartSpec, d: ChartData, b: Box): string {
  const vals = d.series[0].vals.map((v) => (num(v) ? v : 0));
  const steps: { a: number; z: number; total: boolean; v: number }[] = [];
  let run = 0;
  vals.forEach((v, i) => {
    const total = spec.totals ? spec.totals.includes(i) : /total|net|sum|end/i.test(d.cats[i]) && i > 0;
    if (total) steps.push({ a: 0, z: run, total, v: run });
    else {
      steps.push({ a: run, z: run + v, total: false, v });
      run += v;
    }
  });
  const sc = nice(Math.min(0, ...steps.flatMap((s) => [s.a, s.z])), Math.max(0, ...steps.flatMap((s) => [s.a, s.z])));
  const lw = labelWidth(sc.ticks.map((t) => shown(spec.yFmt, t))) + (spec.yTitle ? 18 : 0);
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 10), h: Math.max(10, b.h - 28 - (spec.xTitle ? 18 : 0)) };
  const py = (v: number) => p.y + p.h - ((v - sc.min) / (sc.max - sc.min)) * p.h;
  const out: string[] = [];
  if (spec.plotFill) out.push(`<rect x="${r1(p.x)}" y="${r1(p.y)}" width="${r1(p.w)}" height="${r1(p.h)}" fill="${esc(spec.plotFill)}"/>`);
  sc.ticks.forEach((t) => out.push(spec.grid === false ? '' : line(p.x, py(t), p.x + p.w, py(t)), text(p.x - 6, py(t), shown(spec.yFmt, t), { anchor: 'end', base: 'central' })));
  const band = p.w / steps.length;
  steps.forEach((s, i) => {
    const x = p.x + band * i + band * 0.15;
    const fill = s.total ? color(0) : s.v >= 0 ? '#59a14f' : '#e15759';
    out.push(`<rect x="${r1(x)}" y="${r1(Math.min(py(s.a), py(s.z)))}" width="${r1(band * 0.7)}" height="${r1(Math.max(1, Math.abs(py(s.a) - py(s.z))))}" fill="${fill}"/>`);
    if (i < steps.length - 1) out.push(line(x + band * 0.7, py(s.z), x + band * 1.15, py(s.z), 'stroke-opacity="0.4" stroke-dasharray="3 3"'));
    out.push(text(p.x + band * (i + 0.5), p.y + p.h + 15, ellipsis(d.cats[i], 12)));
    if (spec.labels) out.push(text(p.x + band * (i + 0.5), Math.min(py(s.a), py(s.z)) - 4, (s.v > 0 && !s.total ? '+' : '') + shown(spec.labelFmt, s.v), { size: 10 }));
  });
  out.push(line(p.x, py(0), p.x + p.w, py(0), 'stroke-opacity="0.4"'));
  if (spec.yTitle) out.push(text(b.x + 8, p.y + p.h / 2, spec.yTitle, { size: 11, rot: -90, op: 0.8 }));
  return out.join('');
}

function candlestick(spec: ChartSpec, d: ChartData, b: Box): string {
  const find = (re: RegExp, fallback: number) => d.series.find((s) => re.test(s.name)) ?? d.series[fallback];
  const [o, h, l, c] = [find(/open/i, 0), find(/high/i, 1), find(/low/i, 2), find(/close/i, 3)];
  if (!o || !h || !l || !c) return text(b.x + b.w / 2, b.y + b.h / 2, 'Candlestick needs four series: open, high, low, close', { op: 0.6 });
  const all = [...h.vals, ...l.vals].filter(num);
  const sc = nice(Math.min(...all), Math.max(...all));
  const lw = labelWidth(sc.ticks.map(fmt)) + (spec.yTitle ? 18 : 0);
  const n = d.cats.length;
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 10), h: Math.max(10, b.h - 28 - (spec.xTitle ? 18 : 0)) };
  const py = (v: number) => p.y + p.h - ((v - sc.min) / (sc.max - sc.min)) * p.h;
  const out: string[] = [];
  sc.ticks.forEach((t) => out.push(line(p.x, py(t), p.x + p.w, py(t)), text(p.x - 6, py(t), fmt(t), { anchor: 'end', base: 'central' })));
  const band = p.w / n;
  const every = Math.max(1, Math.ceil((n * 60) / p.w));
  for (let k = 0; k < n; k++) {
    const [ov, hv, lv, cv] = [o.vals[k], h.vals[k], l.vals[k], c.vals[k]];
    if (![ov, hv, lv, cv].every(num)) continue;
    const up = (cv as number) >= (ov as number);
    const col = up ? '#59a14f' : '#e15759';
    const x = p.x + band * (k + 0.5);
    out.push(`<line x1="${r1(x)}" y1="${r1(py(hv as number))}" x2="${r1(x)}" y2="${r1(py(lv as number))}" stroke="${col}" stroke-width="1.5"/>`);
    out.push(`<rect x="${r1(x - band * 0.3)}" y="${r1(py(Math.max(ov as number, cv as number)))}" width="${r1(band * 0.6)}" height="${r1(Math.max(1, Math.abs(py(ov as number) - py(cv as number))))}" fill="${col}"/>`);
    const cat = d.catNums[k] !== null && (d.catNums[k] as number) > 20000 ? serial(d.catNums[k] as number) : d.cats[k];
    if (k % every === 0) out.push(text(x, p.y + p.h + 15, ellipsis(cat, 10)));
  }
  out.push(line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, 'stroke-opacity="0.4"'));
  if (spec.yTitle) out.push(text(b.x + 8, p.y + p.h / 2, spec.yTitle, { size: 11, rot: -90, op: 0.8 }));
  return out.join('');
}

interface TNode {
  name: string;
  v: number;
  kids: TNode[];
  top: number;
}

function treeOf(d: ChartData): TNode[] {
  const roots: TNode[] = [];
  const vals = d.series[0]?.vals ?? [];
  (d.paths ?? []).forEach((path, k) => {
    const v = vals[k];
    if (!num(v) || v <= 0) return;
    let level = roots;
    let top = -1;
    path.forEach((name, depth) => {
      let node = level.find((n) => n.name === name);
      if (!node) {
        if (depth === 0) top = roots.length;
        node = { name, v: 0, kids: [], top: depth === 0 ? roots.length : top };
        level.push(node);
      }
      top = node.top;
      node.v += v;
      level = node.kids;
    });
  });
  return roots;
}

function depthOf(list: TNode[]): number {
  return list.length ? 1 + Math.max(...list.map((n) => depthOf(n.kids))) : 0;
}

function treemapNested(spec: ChartSpec, d: ChartData, b: Box): string {
  const out: string[] = [];
  const place = (list: TNode[], x: number, y: number, w: number, h: number, depth: number) => {
    const sorted = [...list].sort((a, c) => c.v - a.v);
    const split = (nodes: TNode[], sx: number, sy: number, sw: number, sh: number) => {
      if (!nodes.length) return;
      if (nodes.length === 1) {
        const n = nodes[0];
        const parent = n.kids.length > 0 && sw > 36 && sh > 36;
        out.push(`<rect x="${r1(sx)}" y="${r1(sy)}" width="${r1(sw)}" height="${r1(sh)}" fill="${color(n.top)}" fill-opacity="${parent ? 0.28 + depth * 0.1 : 0.95 - Math.min(0.3, depth * 0.1)}" stroke="var(--cell-bg, #fff)" stroke-width="2"><title>${esc(n.name)}: ${fmt(n.v)}</title></rect>`);
        if (sw > 40 && sh > 16) out.push(text(sx + 5, sy + 13, ellipsis(n.name, Math.floor(sw / 6.5)), { anchor: 'start', fill: parent ? 'currentColor' : '#fff', size: 11, bold: true }));
        if (!parent && sw > 40 && sh > 32 && spec.labels) out.push(text(sx + 5, sy + 27, shown(spec.labelFmt, n.v), { anchor: 'start', fill: '#fff', size: 10 }));
        if (parent) place(n.kids, sx + 3, sy + 18, sw - 6, sh - 21, depth + 1);
        return;
      }
      const total = nodes.reduce((a, n) => a + n.v, 0);
      let acc = 0;
      let k = 0;
      while (k < nodes.length - 1 && acc + nodes[k].v <= total / 2) acc += nodes[k++].v;
      if (k === 0) {
        acc = nodes[0].v;
        k = 1;
      }
      const f = acc / total;
      if (sw >= sh) {
        split(nodes.slice(0, k), sx, sy, sw * f, sh);
        split(nodes.slice(k), sx + sw * f, sy, sw * (1 - f), sh);
      } else {
        split(nodes.slice(0, k), sx, sy, sw, sh * f);
        split(nodes.slice(k), sx, sy + sh * f, sw, sh * (1 - f));
      }
    };
    split(sorted, x, y, w, h);
  };
  place(treeOf(d), b.x, b.y, b.w, b.h, 0);
  return out.join('');
}

function sunburstNested(d: ChartData, b: Box): string {
  const roots = treeOf(d);
  const levels = Math.max(1, depthOf(roots));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const R = Math.max(20, Math.min(b.w, b.h) / 2 - 8);
  const ring = R / levels;
  const out: string[] = [];
  const walk = (list: TNode[], a0: number, a1: number, depth: number) => {
    const sum = list.reduce((a, n) => a + n.v, 0) || 1;
    let a = a0;
    for (const n of list) {
      const sweep = ((a1 - a0) * n.v) / sum;
      out.push(`<path d="${arc(cx, cy, ring * depth + (depth ? 1 : 0), ring * (depth + 1), a, a + sweep)}" fill="${color(n.top)}" fill-opacity="${1 - Math.min(0.5, depth * 0.14)}" stroke="var(--cell-bg, #fff)" stroke-width="1.25"><title>${esc(n.name)}: ${fmt(n.v)}</title></path>`);
      const mid = a + sweep / 2;
      const rr = ring * (depth + 0.5);
      if (sweep * rr > 24 && ring > 16) out.push(text(cx + rr * Math.cos(mid), cy + rr * Math.sin(mid), ellipsis(n.name, Math.max(3, Math.floor((sweep * rr) / 6))), { fill: '#fff', size: 10, base: 'central', bold: true }));
      walk(n.kids, a, a + sweep, depth + 1);
      a += sweep;
    }
  };
  walk(roots, -Math.PI / 2, (Math.PI * 3) / 2, 0);
  return out.join('');
}

function treemap(spec: ChartSpec, d: ChartData, b: Box): string {
  if (d.paths?.length) return treemapNested(spec, d, b);
  const items = d.series[0].vals.map((v, i) => ({ v: num(v) && v > 0 ? v : 0, i })).filter((x) => x.v > 0).sort((a, c) => c.v - a.v);
  const out: string[] = [];
  const split = (list: typeof items, x: number, y: number, w: number, h: number) => {
    if (!list.length) return;
    if (list.length === 1) {
      const it = list[0];
      out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${color(it.i)}" stroke="var(--cell-bg, #fff)" stroke-width="2"/>`);
      if (w > 40 && h > 18) out.push(text(x + 6, y + 14, ellipsis(d.cats[it.i], Math.floor(w / 6.5)), { anchor: 'start', fill: '#fff', size: 11, bold: true }), spec.labels || h > 34 ? text(x + 6, y + 28, fmt(it.v), { anchor: 'start', fill: '#fff', size: 10 }) : '');
      return;
    }
    const total = list.reduce((a, it) => a + it.v, 0);
    let acc = 0;
    let k = 0;
    while (k < list.length - 1 && acc + list[k].v <= total / 2) acc += list[k++].v;
    if (k === 0) { acc = list[0].v; k = 1; }
    const a = list.slice(0, k);
    const c = list.slice(k);
    const frac = acc / total;
    if (w >= h) {
      split(a, x, y, w * frac, h);
      split(c, x + w * frac, y, w * (1 - frac), h);
    } else {
      split(a, x, y, w, h * frac);
      split(c, x, y + h * frac, w, h * (1 - frac));
    }
  };
  split(items, b.x, b.y, b.w, b.h);
  return out.join('');
}

function sunburst(spec: ChartSpec, d: ChartData, b: Box): string {
  if (d.paths?.length) return sunburstNested(d, b);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const R = Math.max(20, Math.min(b.w, b.h) / 2 - 8);
  const pos = (v: number | null) => (num(v) && v > 0 ? v : 0);
  const sums = d.cats.map((_, k) => d.series.reduce((a, s) => a + pos(s.vals[k]), 0));
  const total = sums.reduce((a, v) => a + v, 0) || 1;
  const out: string[] = [];
  let a = -Math.PI / 2;
  const multi = d.series.length > 1;
  sums.forEach((sum, k) => {
    if (!sum) return;
    const sweep = (sum / total) * Math.PI * 2;
    out.push(`<path d="${arc(cx, cy, 0, multi ? R * 0.45 : R, a, a + sweep)}" fill="${color(k)}" stroke="var(--cell-bg, #fff)" stroke-width="1.5"/>`);
    if (sweep > 0.25) out.push(text(cx + R * (multi ? 0.28 : 0.6) * Math.cos(a + sweep / 2), cy + R * (multi ? 0.28 : 0.6) * Math.sin(a + sweep / 2), ellipsis(d.cats[k], 8), { fill: '#fff', size: 10, base: 'central', bold: true }));
    if (multi) {
      let b2 = a;
      d.series.forEach((s) => {
        const v = pos(s.vals[k]);
        if (!v) return;
        const sw = (v / total) * Math.PI * 2;
        out.push(`<path d="${arc(cx, cy, R * 0.47, R, b2, b2 + sw)}" fill="${color(k)}" fill-opacity="0.6" stroke="var(--cell-bg, #fff)" stroke-width="1.5"><title>${esc(d.cats[k])} / ${esc(s.name)}: ${fmt(v)}</title></path>`);
        if (sw > 0.18 && spec.labels) out.push(text(cx + R * 0.74 * Math.cos(b2 + sw / 2), cy + R * 0.74 * Math.sin(b2 + sw / 2), ellipsis(s.name, 6), { size: 9, base: 'central' }));
        b2 += sw;
      });
    }
    a += sweep;
  });
  return out.join('');
}

function funnel(_spec: ChartSpec, d: ChartData, b: Box): string {
  const vals = d.series[0].vals.map((v) => (num(v) && v > 0 ? v : 0));
  const max = Math.max(...vals, 1);
  const n = vals.length;
  const rh = b.h / n;
  const cx = b.x + b.w / 2;
  const out: string[] = [];
  vals.forEach((v, i) => {
    const w1 = (v / max) * b.w * 0.92;
    const w2 = ((vals[i + 1] ?? v * 0.7) / max) * b.w * 0.92;
    const y = b.y + i * rh;
    out.push(`<path d="M${r1(cx - w1 / 2)} ${r1(y + 1)}L${r1(cx + w1 / 2)} ${r1(y + 1)}L${r1(cx + w2 / 2)} ${r1(y + rh - 1)}L${r1(cx - w2 / 2)} ${r1(y + rh - 1)}Z" fill="${color(i)}"/>`);
    out.push(text(cx, y + rh / 2, `${ellipsis(d.cats[i], 16)}  ${fmt(v)}`, { fill: '#fff', size: 11, base: 'central', bold: true }));
  });
  return out.join('');
}

function lastOf(s: Series): number | null {
  for (let i = s.vals.length - 1; i >= 0; i--) if (num(s.vals[i])) return s.vals[i];
  return null;
}

function gauge(spec: ChartSpec, d: ChartData, b: Box): string {
  const v = lastOf(d.series[0]) ?? 0;
  const lo = spec.min ?? 0;
  const hi = spec.max ?? nice(lo, Math.max(v, lo + 1)).max;
  const frac = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  const R = Math.max(20, Math.min(b.w / 2 - 10, b.h - 30));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2 + R / 2 - 6;
  const out: string[] = [];
  out.push(`<path d="${arc(cx, cy, R * 0.68, R, Math.PI, Math.PI * 2)}" fill="currentColor" fill-opacity="0.12"/>`);
  const [t1, t2] = spec.bands ? spec.bands.map((x) => Math.max(0, Math.min(1, (x - lo) / (hi - lo || 1)))) : [0.33, 0.66];
  if (spec.bands) {
    const edges = [0, t1, t2, 1];
    ['#e15759', '#edc948', '#59a14f'].forEach((c, i) => {
      if (edges[i + 1] > edges[i]) out.push(`<path d="${arc(cx, cy, R * 0.68, R, Math.PI + Math.PI * edges[i], Math.PI + Math.PI * edges[i + 1])}" fill="${c}" fill-opacity="0.28"/>`);
    });
  }
  if (frac > 0) out.push(`<path d="${arc(cx, cy, R * 0.68, R, Math.PI, Math.PI + Math.PI * frac)}" fill="${frac > t2 ? '#59a14f' : frac > t1 ? '#edc948' : '#e15759'}"/>`);
  out.push(text(cx, cy - R * 0.18, fmt(v), { size: Math.max(14, R / 3), bold: true, base: 'central' }));
  out.push(text(cx - R * 0.84, cy + 13, fmt(lo), { size: 10, op: 0.7 }), text(cx + R * 0.84, cy + 13, fmt(hi), { size: 10, op: 0.7 }));
  return out.join('');
}

function scorecard(_spec: ChartSpec, d: ChartData, b: Box): string {
  const s = d.series[0];
  const nums = s.vals.filter(num);
  const v = nums[nums.length - 1];
  const prev = nums.length > 1 ? nums[nums.length - 2] : null;
  const cx = b.x + b.w / 2;
  const big = Math.max(18, Math.min(b.h * 0.34, b.w / 6));
  const out: string[] = [];
  out.push(text(cx, b.y + b.h * 0.32, ellipsis(s.name, 30), { size: 12, op: 0.7 }), text(cx, b.y + b.h * 0.32 + big, fmt(v), { size: big, bold: true, base: 'central' }));
  if (prev !== null && prev !== 0) {
    const change = ((v - prev) / Math.abs(prev)) * 100;
    out.push(text(cx, b.y + b.h * 0.32 + big * 2, `${change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 10) / 10)}%`, { size: 13, fill: change >= 0 ? '#59a14f' : '#e15759', bold: true }));
  }
  if (nums.length > 2) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const w = Math.min(b.w * 0.6, 160);
    const pts = nums.map((x, i) => `${i ? 'L' : 'M'}${r1(cx - w / 2 + (i / (nums.length - 1)) * w)} ${r1(b.y + b.h - 14 - ((x - lo) / (hi - lo || 1)) * 22)}`).join('');
    out.push(`<path d="${pts}" fill="none" stroke="${color(0)}" stroke-width="1.5"/>`);
  }
  return out.join('');
}

function radar(_spec: ChartSpec, d: ChartData, b: Box): string {
  const n = d.cats.length;
  const all = d.series.flatMap((s) => s.vals).filter(num);
  const sc = nice(Math.min(0, ...all), Math.max(...all), 4);
  const R = Math.max(20, Math.min(b.w, b.h) / 2 - 22);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const ang = (k: number) => -Math.PI / 2 + (k / n) * Math.PI * 2;
  const rad = (v: number) => ((v - sc.min) / (sc.max - sc.min)) * R;
  const out: string[] = [];
  sc.ticks.forEach((t) => {
    const pts = d.cats.map((_, k) => `${r1(cx + rad(t) * Math.cos(ang(k)))},${r1(cy + rad(t) * Math.sin(ang(k)))}`).join(' ');
    out.push(`<polygon points="${pts}" fill="none" stroke="currentColor" stroke-opacity="0.15"/>`);
  });
  d.cats.forEach((c, k) => {
    out.push(line(cx, cy, cx + R * Math.cos(ang(k)), cy + R * Math.sin(ang(k))));
    const cosA = Math.cos(ang(k));
    out.push(text(cx + (R + 8) * cosA, cy + (R + 8) * Math.sin(ang(k)), ellipsis(c, 10), { anchor: Math.abs(cosA) < 0.2 ? 'middle' : cosA > 0 ? 'start' : 'end', base: 'central', size: 10 }));
  });
  d.series.forEach((s, i) => {
    const pts = s.vals.map((v, k) => `${r1(cx + rad(v ?? 0) * Math.cos(ang(k)))},${r1(cy + rad(v ?? 0) * Math.sin(ang(k)))}`).join(' ');
    out.push(`<polygon points="${pts}" fill="${color(i)}" fill-opacity="0.25" stroke="${color(i)}" stroke-width="2"/>`);
  });
  return out.join('');
}

const KIT: Kit = { text, line, nice, serial, fmt, color, esc, r1 };

function timeline(spec: ChartSpec, d: ChartData, b: Box): string {
  if (isAnnotated(spec, d)) return annotatedTimeline(d, b, KIT);
  const labeled = d.series.length >= 3 && !d.series[0].vals.some(num);
  const start = d.series[labeled ? 1 : 0]?.vals ?? [];
  const second = d.series[labeled ? 2 : 1]?.vals ?? [];
  const bars = d.cats.map((c, k) => {
    const a = start[k];
    let z = second[k];
    if (!num(a)) return null;
    if (!num(z)) z = a + 1;
    if (z < a) z = a + z;
    return { c, a, z, name: labeled ? d.series[0].txt[k] || c : c };
  }).filter((x): x is { c: string; a: number; z: number; name: string } => !!x);
  if (!bars.length) return text(b.x + b.w / 2, b.y + b.h / 2, 'Timeline needs task, start and end columns', { op: 0.6 });
  const order: string[] = [];
  for (const r of bars) if (!order.includes(r.c)) order.push(r.c);
  const row = (c: string) => order.indexOf(c);
  const perTask = labeled && spec.tlMode === 'gantt';
  const grouped = labeled && !perTask;
  const lanes = grouped ? order.length : bars.length;
  const laneNames = grouped ? order : bars.map((r) => (perTask ? r.name : r.c));
  const sc = nice(Math.min(...bars.map((r) => r.a)), Math.max(...bars.map((r) => r.z)), 6);
  const dates = sc.min > 20000;
  const fmtT = (v: number) => (dates ? serial(v) : fmt(v));
  const lw = Math.min(perTask ? 170 : 110, labelWidth(laneNames.map((s) => ellipsis(s, perTask ? 28 : 16))));
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 14), h: Math.max(10, b.h - 28) };
  const px = (v: number) => p.x + ((v - sc.min) / (sc.max - sc.min)) * p.w;
  const rh = p.h / lanes;
  const out: string[] = [];
  sc.ticks.forEach((t) => out.push(line(px(t), p.y, px(t), p.y + p.h), text(px(t), p.y + p.h + 14, fmtT(t), { size: 10 })));
  laneNames.forEach((c, i) => out.push(text(p.x - 6, p.y + rh * (i + 0.5), ellipsis(c, perTask ? 28 : 16), { anchor: 'end', base: 'central', size: perTask && rh < 16 ? 9 : 11 })));
  bars.forEach((r, i) => {
    const lane = grouped ? row(r.c) : i;
    const w = Math.max(3, px(r.z) - px(r.a));
    out.push(`<rect x="${r1(px(r.a))}" y="${r1(p.y + rh * lane + rh * 0.2)}" width="${r1(w)}" height="${r1(rh * 0.6)}" rx="3" fill="${color(perTask ? row(r.c) : labeled ? i : lane)}"><title>${esc(r.name)}: ${fmtT(r.a)} to ${fmtT(r.z)}</title></rect>`);
    if (grouped && w > 36 && rh > 14) out.push(text(px(r.a) + 4, p.y + rh * (lane + 0.5), ellipsis(r.name, Math.floor(w / 6.2)), { anchor: 'start', base: 'central', fill: '#fff', size: 10 }));
  });
  return out.join('');
}

function org(spec: ChartSpec, d: ChartData, b: Box): string {
  const parent = d.series[0]?.txt ?? [];
  const names = d.cats;
  const index = new Map<string, number>();
  names.forEach((n, i) => {
    if (n !== '' && !index.has(n)) index.set(n, i);
  });
  const folded = new Set(spec.collapsed ?? []);
  const kids = new Map<number, number[]>();
  const roots: number[] = [];
  names.forEach((n, i) => {
    if (n === '') return;
    const p = index.get(parent[i] ?? '');
    if (p === undefined || p === i) roots.push(i);
    else kids.set(p, [...(kids.get(p) ?? []), i]);
  });
  if (!roots.length) return text(b.x + b.w / 2, b.y + b.h / 2, 'Org chart needs name and manager columns', { op: 0.6 });
  const depth = new Map<number, number>();
  const xpos = new Map<number, number>();
  let leaf = 0;
  let maxDepth = 0;
  const seen = new Set<number>();
  const walk = (i: number, dp: number): number => {
    seen.add(i);
    depth.set(i, dp);
    maxDepth = Math.max(maxDepth, dp);
    const cs = folded.has(names[i]) ? [] : (kids.get(i) ?? []).filter((c) => !seen.has(c));
    if (!cs.length) {
      xpos.set(i, leaf++);
      return leaf - 1;
    }
    const xs = cs.map((c) => walk(c, dp + 1));
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    xpos.set(i, x);
    return x;
  };
  roots.forEach((r) => walk(r, 0));
  const bw = Math.min(110, b.w / Math.max(1, leaf) - 8);
  const colW = b.w / Math.max(1, leaf);
  const rowH = b.h / (maxDepth + 1);
  const sub = d.series[1]?.txt ?? [];
  const bh = Math.min(sub.some(Boolean) ? 40 : 30, rowH - 14);
  const pos = (i: number) => [b.x + colW * ((xpos.get(i) ?? 0) + 0.5), b.y + rowH * (depth.get(i) ?? 0) + rowH / 2 - bh / 2] as const;
  const out: string[] = [];
  for (const [p, cs] of kids) {
    if (!depth.has(p)) continue;
    const [px, py] = pos(p);
    for (const c of cs) {
      if (!depth.has(c)) continue;
      const [cx, cy] = pos(c);
      const my = (py + bh + cy) / 2;
      out.push(`<path d="M${r1(px)} ${r1(py + bh)}V${r1(my)}H${r1(cx)}V${r1(cy)}" fill="none" stroke="currentColor" stroke-opacity="0.4"/>`);
    }
  }
  for (const i of depth.keys()) {
    const [x, y] = pos(i);
    const two = !!sub[i] && bh >= 34;
    const below = (kids.get(i) ?? []).length;
    const toggle = below ? `<g class="fc-org-toggle" data-toggle="${i}" style="cursor:pointer"><circle cx="${r1(x)}" cy="${r1(y + bh)}" r="7" fill="var(--cell-bg, #fff)" stroke="currentColor" stroke-opacity="0.6"/>${text(x, y + bh + 0.5, folded.has(names[i]) ? '+' : '−', { base: 'central', size: 11, bold: true })}</g>` : '';
    out.push(`<g class="fc-org-node" data-i="${i}"><rect x="${r1(x - bw / 2)}" y="${r1(y)}" width="${r1(bw)}" height="${r1(bh)}" rx="4" fill="${color(depth.get(i) ?? 0)}"><title>${esc(names[i])}${sub[i] ? `, ${esc(sub[i])}` : ''}</title></rect>${text(x, y + (two ? bh * 0.35 : bh / 2), ellipsis(names[i], Math.max(3, Math.floor(bw / 6.5))), { fill: '#fff', base: 'central', size: 11, bold: true })}${two ? text(x, y + bh * 0.72, ellipsis(sub[i], Math.max(3, Math.floor(bw / 5.5))), { fill: '#fff', base: 'central', size: 9, op: 0.9 }) : ''}</g>${toggle}`);
  }
  return out.join('');
}

let mapSeq = 0;

function regionMap(spec: ChartSpec, d: ChartData, b: Box, plan: MapPlan): string {
  const vals = d.series[0]?.vals ?? [];
  const by = new Map<Region, number>();
  let missed = 0;
  d.cats.forEach((_, i) => {
    if (!num(vals[i])) return;
    if (![...plan.rows.values()].some((rows) => rows.includes(i))) missed++;
  });
  for (const [r, rows] of plan.rows) {
    const got = rows.map((i) => vals[i]).filter(num);
    if (got.length) by.set(r, got.reduce((s, v) => s + v, 0));
  }
  const nums = [...by.values()];
  const lo = nums.length ? Math.min(...nums) : 0;
  const hi = nums.length ? Math.max(...nums) : 1;
  const barH = 26;
  const all = regionsIn(plan.countries);
  const [x0, y0, x1, y1] = bounds(all);
  const kx = Math.max(0.2, Math.cos((-(y0 + y1) / 2 / REGION_UNITS) * (Math.PI / 180)));
  const k = Math.min((b.w - 8) / ((x1 - x0) * kx || 1), (b.h - barH - 8) / (y1 - y0 || 1));
  const tx = b.x + (b.w - (x1 - x0) * k * kx) / 2 - x0 * k * kx;
  const ty = b.y + (b.h - barH - (y1 - y0) * k) / 2 - y0 * k;
  const id = `fcmap${mapSeq++}`;
  const base = color(0);
  const out: string[] = [`<defs><linearGradient id="${id}"><stop offset="0" stop-color="${ramp(0, base)}"/><stop offset="1" stop-color="${ramp(1, base)}"/></linearGradient></defs>`];
  out.push(`<g transform="translate(${r1(tx)} ${r1(ty)}) scale(${Math.round(k * kx * 10000) / 10000} ${Math.round(k * 10000) / 10000})">`);
  for (const r of all) {
    const v = by.get(r);
    const fill = v === undefined ? 'currentColor' : ramp((v - lo) / (hi - lo || 1), base);
    out.push(`<path d="${r[3]}" fill="${fill}"${v === undefined ? ' fill-opacity="0.08"' : ''} stroke="var(--cell-bg, #fff)" stroke-width="0.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"><title>${esc(r[0])}${v === undefined ? '' : `: ${shown(spec.labelFmt, v)}`}</title></path>`);
  }
  out.push('</g>');
  if (spec.labels) {
    for (const r of all) {
      const v = by.get(r);
      if (v === undefined) continue;
      const [x, y] = center(r);
      const [rx0, ry0, rx1, ry1] = pathBox(r[3]);
      const wpx = (rx1 - rx0) * k * kx;
      const hpx = (ry1 - ry0) * k;
      const label = r[0];
      if (wpx < Math.min(34, label.length * 4.2) || hpx < 9) continue;
      const t = (v - lo) / (hi - lo || 1);
      out.push(text(tx + x * k * kx, ty + y * k, ellipsis(label, Math.max(3, Math.floor(wpx / 5.2))), { base: 'central', size: 9, fill: t > 0.6 ? '#fff' : '#1b1f24', halo: t > 0.6 ? '#1b1f24' : '#fff' }));
    }
  }
  const bw = Math.min(160, b.w * 0.5);
  const by0 = b.y + b.h - barH + 6;
  const bx = b.x + (b.w - bw) / 2;
  out.push(`<rect x="${r1(bx)}" y="${r1(by0)}" width="${r1(bw)}" height="8" rx="2" fill="url(#${id})"/>`);
  out.push(text(bx - 4, by0 + 4, shown(spec.labelFmt, lo), { anchor: 'end', base: 'central', size: 10 }), text(bx + bw + 4, by0 + 4, shown(spec.labelFmt, hi), { anchor: 'start', base: 'central', size: 10 }));
  if (missed) out.push(text(b.x + b.w - 2, b.y + b.h - 4, `${missed} not on the map`, { anchor: 'end', size: 9, op: 0.6 }));
  return out.join('');
}

function mapChart(spec: ChartSpec, d: ChartData, b: Box): string {
  const plan = planMap(d.cats, spec.level);
  if (plan.level === 'region' && plan.rows.size) return regionMap(spec, d, b, plan);
  const vals = d.series[0]?.vals ?? [];
  const by = new Map<string, number>();
  let missed = 0;
  d.cats.forEach((c, k) => {
    const hit = countryFor(c);
    const v = vals[k];
    if (!num(v)) return;
    if (!hit) missed++;
    else by.set(hit[2], (by.get(hit[2]) ?? 0) + v);
  });
  const nums = [...by.values()];
  const lo = nums.length ? Math.min(...nums) : 0;
  const hi = nums.length ? Math.max(...nums) : 1;
  const barH = 26;
  const k = Math.min(b.w / WORLD_W, (b.h - barH) / WORLD_H);
  const tx = b.x + (b.w - WORLD_W * k) / 2;
  const ty = b.y + (b.h - barH - WORLD_H * k) / 2;
  const id = `fcmap${mapSeq++}`;
  const out: string[] = [];
  const base = color(0);
  out.push(`<defs><linearGradient id="${id}"><stop offset="0" stop-color="${ramp(0, base)}"/><stop offset="1" stop-color="${ramp(1, base)}"/></linearGradient></defs>`);
  out.push(`<g transform="translate(${r1(tx)} ${r1(ty)}) scale(${Math.round(k * 1000) / 1000})">`);
  for (const c of WORLD) {
    const v = by.get(c[2]);
    const fill = v === undefined ? 'currentColor' : ramp((v - lo) / (hi - lo || 1), base);
    out.push(`<path d="${c[4]}" fill="${fill}"${v === undefined ? ' fill-opacity="0.08"' : ''} stroke="var(--cell-bg, #fff)" stroke-width="${r1(0.8 / Math.max(k, 0.05))}" stroke-linejoin="round"><title>${esc(c[0])}${v === undefined ? '' : `: ${shown(spec.labelFmt, v)}`}</title></path>`);
  }
  out.push('</g>');
  if (spec.labels) {
    for (const c of WORLD) {
      const v = by.get(c[2]);
      if (v === undefined) continue;
      const [x0, y0, x1, y1] = pathBox(c[4]);
      const wpx = (x1 - x0) * k;
      if (wpx < Math.min(34, c[0].length * 4.2) || (y1 - y0) * k < 9) continue;
      const t = (v - lo) / (hi - lo || 1);
      out.push(text(tx + ((x0 + x1) / 2) * k, ty + ((y0 + y1) / 2) * k, ellipsis(c[0], Math.max(3, Math.floor(wpx / 5.2))), { base: 'central', size: 9, fill: t > 0.6 ? '#fff' : '#1b1f24', halo: t > 0.6 ? '#1b1f24' : '#fff' }));
    }
  }
  const bw = Math.min(160, b.w * 0.5);
  const by0 = b.y + b.h - barH + 6;
  const bx = b.x + (b.w - bw) / 2;
  out.push(`<rect x="${r1(bx)}" y="${r1(by0)}" width="${r1(bw)}" height="8" rx="2" fill="url(#${id})"/>`);
  out.push(text(bx - 4, by0 + 4, shown(spec.labelFmt, lo), { anchor: 'end', base: 'central', size: 10 }), text(bx + bw + 4, by0 + 4, shown(spec.labelFmt, hi), { anchor: 'start', base: 'central', size: 10 }));
  if (missed) out.push(text(b.x + b.w - 2, b.y + b.h - 4, `${missed} not on the map`, { anchor: 'end', size: 9, op: 0.6 }));
  return out.join('');
}

const GENERATORS: Record<string, Gen> = {
  map: mapChart,
  scatter: xy,
  bubble: xy,
  pie,
  doughnut: pie,
  histogram,
  box,
  waterfall,
  candlestick,
  treemap,
  sunburst,
  funnel,
  gauge,
  scorecard,
  radar,
  timeline,
  org,
};
