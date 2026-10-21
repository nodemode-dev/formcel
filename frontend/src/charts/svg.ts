import { PALETTE, type ChartData, type ChartSpec, type Series } from './types';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const r1 = (n: number): string => String(Math.round(n * 10) / 10);
const color = (i: number): string => PALETTE[i % PALETTE.length];

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

const text = (x: number, y: number, s: string, o: { size?: number; anchor?: string; bold?: boolean; rot?: number; fill?: string; base?: string; op?: number } = {}): string =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${o.size ?? 11}" text-anchor="${o.anchor ?? 'middle'}"${o.base ? ` dominant-baseline="${o.base}"` : ''}${o.bold ? ' font-weight="600"' : ''} fill="${o.fill ?? 'currentColor'}"${o.op ? ` fill-opacity="${o.op}"` : ''}${o.rot ? ` transform="rotate(${o.rot} ${r1(x)} ${r1(y)})"` : ''}>${esc(s)}</text>`;

const line = (x1: number, y1: number, x2: number, y2: number, o = 'stroke-opacity="0.15"', w = 1): string =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="currentColor" ${o} stroke-width="${w}"/>`;

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
  if (['histogram', 'waterfall', 'gauge', 'scorecard', 'org', 'timeline', 'box'].includes(t)) return [];
  if (t === 'candlestick') return [];
  if (t === 'radar' || d.series.length > 1) return d.series.map((s) => s.name);
  return [];
}

export function renderChart(spec: ChartSpec, d: ChartData, w: number, h: number): string {
  w = Math.max(60, Math.round(w));
  h = Math.max(40, Math.round(h));
  const parts: string[] = [];
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(spec.title || spec.type)}" font-family="Inter, system-ui, -apple-system, 'Segoe UI', sans-serif">${parts.join('')}${body}</svg>`;
}

function labelWidth(ticks: string[]): number {
  return Math.max(...ticks.map((t) => t.length)) * 6.4 + 10;
}

function cartesian(spec: ChartSpec, d: ChartData, b: Box): string {
  const t = spec.type;
  const horizontal = t === 'bar' || t === 'bar-stacked';
  const stacked = t === 'column-stacked' || t === 'bar-stacked';
  const area = t === 'area';
  const isLine = t === 'line' || area;
  const combo = t === 'combo';
  const n = d.cats.length;
  const secIdx = new Set(combo ? (spec.secondary.length ? spec.secondary : d.series.length > 1 ? [d.series.length - 1] : []) : []);
  const left = d.series.map((s, i) => ({ s, i })).filter(({ i }) => !secIdx.has(i));
  const sec = d.series.map((s, i) => ({ s, i })).filter(({ i }) => secIdx.has(i));
  const range = (list: { s: Series }[], stack: boolean, zero: boolean): [number, number] => {
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
      for (const { s } of list) for (const v of s.vals) if (num(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (spec.min !== undefined) lo = spec.min;
    if (spec.max !== undefined) hi = spec.max;
    return [lo, hi];
  };
  const zero = !(isLine && !area);
  const [lo, hi] = range(left, stacked, zero || combo);
  const scale = nice(lo, hi);
  const tickText = scale.ticks.map(fmt);
  const sscale = sec.length ? nice(...range(sec, false, false)) : null;
  const catLabels = d.cats.map((c) => ellipsis(c, 14));
  const lw = horizontal ? Math.min(100, labelWidth(catLabels)) : labelWidth(tickText);
  const rw = sscale ? labelWidth(sscale.ticks.map(fmt)) : 0;
  const padL = lw + (spec.yTitle ? 18 : 0);
  const padB = (horizontal ? labelWidth(tickText) * 0 + 22 : 22) + (spec.xTitle ? 18 : 0);
  const p: Box = { x: b.x + padL, y: b.y + 6, w: Math.max(10, b.w - padL - rw - 6), h: Math.max(10, b.h - padB - 6) };
  const out: string[] = [];
  const toPx = (v: number) => (horizontal ? p.x + ((v - scale.min) / (scale.max - scale.min)) * p.w : p.y + p.h - ((v - scale.min) / (scale.max - scale.min)) * p.h);
  const toSec = (v: number) => p.y + p.h - ((v - sscale!.min) / (sscale!.max - sscale!.min)) * p.h;
  scale.ticks.forEach((v, i) => {
    const q = toPx(v);
    if (horizontal) out.push(line(q, p.y, q, p.y + p.h), text(q, p.y + p.h + 14, tickText[i]));
    else out.push(line(p.x, q, p.x + p.w, q), text(p.x - 6, q, tickText[i], { anchor: 'end', base: 'central' }));
  });
  if (sscale) sscale.ticks.forEach((v) => out.push(text(p.x + p.w + 6, toSec(v), fmt(v), { anchor: 'start', base: 'central' })));
  const band = (horizontal ? p.h : p.w) / Math.max(1, n);
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
        if (spec.labels) out.push(horizontal ? text(Math.max(a, z) + 3, c + bw / 2, fmt(v), { anchor: 'start', base: 'central', size: 10 }) : text(c + bw / 2, lo2 - 3, fmt(v), { size: 10 }));
      });
    });
  }
  const lineSeries = isLine ? d.series.map((s, i) => ({ s, i })) : sec;
  lineSeries.forEach(({ s, i }) => {
    const pts: [number, number, number][] = [];
    s.vals.forEach((v, k) => {
      if (num(v)) pts.push([p.x + band * (k + 0.5), secIdx.has(i) && sscale ? toSec(v) : toPx(v), v]);
    });
    if (!pts.length) return;
    const path = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('');
    if (area) out.push(`<path d="${path}L${r1(pts[pts.length - 1][0])} ${r1(baseV)}L${r1(pts[0][0])} ${r1(baseV)}Z" fill="${color(i)}" fill-opacity="0.35"/>`);
    out.push(`<path d="${path}" fill="none" stroke="${color(i)}" stroke-width="2" stroke-linejoin="round"/>`);
    for (const [x, y, v] of pts) {
      out.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="3" fill="${color(i)}"/>`);
      if (spec.labels) out.push(text(x, y - 7, fmt(v), { size: 10 }));
    }
  });
  if (spec.xTitle) out.push(text(p.x + p.w / 2, b.y + b.h - 4, spec.xTitle, { size: 11, op: 0.8 }));
  if (spec.yTitle) out.push(text(b.x + 8, p.y + p.h / 2, spec.yTitle, { size: 11, rot: -90, op: 0.8 }));
  return out.join('');
}

function xy(spec: ChartSpec, d: ChartData, b: Box): string {
  const bubble = spec.type === 'bubble';
  const ys = bubble ? d.series.slice(0, 1) : d.series;
  const xs = d.catNums.map((v, i) => (num(v) ? v : i + 1));
  const xr = nice(Math.min(...xs), Math.max(...xs));
  const all = ys.flatMap((s) => s.vals).filter(num);
  const yr = nice(Math.min(...all), Math.max(...all));
  const lw = labelWidth(yr.ticks.map(fmt)) + (spec.yTitle ? 18 : 0);
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 10), h: Math.max(10, b.h - 28 - (spec.xTitle ? 18 : 0)) };
  const px = (v: number) => p.x + ((v - xr.min) / (xr.max - xr.min)) * p.w;
  const py = (v: number) => p.y + p.h - ((v - yr.min) / (yr.max - yr.min)) * p.h;
  const out: string[] = [];
  yr.ticks.forEach((v) => out.push(line(p.x, py(v), p.x + p.w, py(v)), text(p.x - 6, py(v), fmt(v), { anchor: 'end', base: 'central' })));
  xr.ticks.forEach((v) => out.push(line(px(v), p.y, px(v), p.y + p.h), text(px(v), p.y + p.h + 14, fmt(v))));
  out.push(line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, 'stroke-opacity="0.4"'), line(p.x, p.y, p.x, p.y + p.h, 'stroke-opacity="0.4"'));
  const sizes = bubble && d.series[1] ? d.series[1].vals : [];
  const maxSize = Math.max(1, ...sizes.filter(num));
  ys.forEach((s, i) => {
    s.vals.forEach((v, k) => {
      if (!num(v)) return;
      const r = bubble ? 5 + 20 * Math.sqrt(Math.max(0, sizes[k] ?? 0) / maxSize) : 4;
      out.push(`<circle cx="${r1(px(xs[k]))}" cy="${r1(py(v))}" r="${r1(r)}" fill="${color(i)}" fill-opacity="${bubble ? 0.55 : 0.85}"/>`);
      if (spec.labels) out.push(text(px(xs[k]), py(v) - r - 3, fmt(v), { size: 10 }));
    });
  });
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
  const bins = Math.max(1, Math.min(30, Math.ceil(Math.log2(v.length) + 1)));
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
    const total = /total|net|sum|end/i.test(d.cats[i]) && i > 0;
    if (total) steps.push({ a: 0, z: run, total, v: run });
    else {
      steps.push({ a: run, z: run + v, total: false, v });
      run += v;
    }
  });
  const sc = nice(Math.min(0, ...steps.flatMap((s) => [s.a, s.z])), Math.max(0, ...steps.flatMap((s) => [s.a, s.z])));
  const lw = labelWidth(sc.ticks.map(fmt)) + (spec.yTitle ? 18 : 0);
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 10), h: Math.max(10, b.h - 28 - (spec.xTitle ? 18 : 0)) };
  const py = (v: number) => p.y + p.h - ((v - sc.min) / (sc.max - sc.min)) * p.h;
  const out: string[] = [];
  sc.ticks.forEach((t) => out.push(line(p.x, py(t), p.x + p.w, py(t)), text(p.x - 6, py(t), fmt(t), { anchor: 'end', base: 'central' })));
  const band = p.w / steps.length;
  steps.forEach((s, i) => {
    const x = p.x + band * i + band * 0.15;
    const fill = s.total ? color(0) : s.v >= 0 ? '#59a14f' : '#e15759';
    out.push(`<rect x="${r1(x)}" y="${r1(Math.min(py(s.a), py(s.z)))}" width="${r1(band * 0.7)}" height="${r1(Math.max(1, Math.abs(py(s.a) - py(s.z))))}" fill="${fill}"/>`);
    if (i < steps.length - 1) out.push(line(x + band * 0.7, py(s.z), x + band * 1.15, py(s.z), 'stroke-opacity="0.4" stroke-dasharray="3 3"'));
    out.push(text(p.x + band * (i + 0.5), p.y + p.h + 15, ellipsis(d.cats[i], 12)));
    if (spec.labels) out.push(text(p.x + band * (i + 0.5), Math.min(py(s.a), py(s.z)) - 4, (s.v > 0 && !s.total ? '+' : '') + fmt(s.v), { size: 10 }));
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

function treemap(spec: ChartSpec, d: ChartData, b: Box): string {
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
  if (frac > 0) out.push(`<path d="${arc(cx, cy, R * 0.68, R, Math.PI, Math.PI + Math.PI * frac)}" fill="${frac > 0.66 ? '#59a14f' : frac > 0.33 ? '#edc948' : '#e15759'}"/>`);
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

function timeline(_spec: ChartSpec, d: ChartData, b: Box): string {
  const start = d.series[0]?.vals ?? [];
  const second = d.series[1]?.vals ?? [];
  const rows = d.cats.map((c, k) => {
    const a = start[k];
    let z = second[k];
    if (!num(a)) return null;
    if (!num(z)) z = a + 1;
    if (z < a) z = a + z;
    return { c, a, z };
  }).filter((x): x is { c: string; a: number; z: number } => !!x);
  if (!rows.length) return text(b.x + b.w / 2, b.y + b.h / 2, 'Timeline needs task, start and end columns', { op: 0.6 });
  const sc = nice(Math.min(...rows.map((r) => r.a)), Math.max(...rows.map((r) => r.z)), 6);
  const dates = sc.min > 20000;
  const fmtT = (v: number) => (dates ? serial(v) : fmt(v));
  const lw = Math.min(110, labelWidth(rows.map((r) => ellipsis(r.c, 16))));
  const p: Box = { x: b.x + lw, y: b.y + 6, w: Math.max(10, b.w - lw - 14), h: Math.max(10, b.h - 28) };
  const px = (v: number) => p.x + ((v - sc.min) / (sc.max - sc.min)) * p.w;
  const rh = p.h / rows.length;
  const out: string[] = [];
  sc.ticks.forEach((t) => out.push(line(px(t), p.y, px(t), p.y + p.h), text(px(t), p.y + p.h + 14, fmtT(t), { size: 10 })));
  rows.forEach((r, i) => {
    out.push(text(p.x - 6, p.y + rh * (i + 0.5), ellipsis(r.c, 16), { anchor: 'end', base: 'central' }));
    out.push(`<rect x="${r1(px(r.a))}" y="${r1(p.y + rh * i + rh * 0.2)}" width="${r1(Math.max(3, px(r.z) - px(r.a)))}" height="${r1(rh * 0.6)}" rx="3" fill="${color(i)}"><title>${esc(r.c)}: ${fmtT(r.a)} to ${fmtT(r.z)}</title></rect>`);
  });
  return out.join('');
}

function org(_spec: ChartSpec, d: ChartData, b: Box): string {
  const parent = d.series[0]?.txt ?? [];
  const names = d.cats;
  const index = new Map(names.map((n, i) => [n, i]));
  const kids = new Map<number, number[]>();
  const roots: number[] = [];
  names.forEach((_, i) => {
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
    const cs = (kids.get(i) ?? []).filter((c) => !seen.has(c));
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
  const bh = Math.min(30, rowH - 14);
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
    out.push(`<rect x="${r1(x - bw / 2)}" y="${r1(y)}" width="${r1(bw)}" height="${r1(bh)}" rx="4" fill="${color(depth.get(i) ?? 0)}"/>${text(x, y + bh / 2, ellipsis(names[i], Math.max(3, Math.floor(bw / 6.5))), { fill: '#fff', base: 'central', size: 11, bold: true })}`);
  }
  return out.join('');
}

const GENERATORS: Record<string, Gen> = {
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
