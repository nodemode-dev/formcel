import type { Box, Kit } from './kit';
import type { ChartData, ChartSpec } from './types';

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function isAnnotated(spec: ChartSpec, d: ChartData): boolean {
  if (spec.tlMode === 'gantt') return false;
  const xs = d.catNums;
  const dated = xs.length >= 2 && xs.every((x) => num(x) && x > 20000);
  const values = d.series.some((s) => s.vals.some(num));
  if (spec.tlMode === 'annotated') return values && xs.length >= 1 && xs.every(num);
  return dated && values;
}

interface Flag {
  x: number;
  v: number;
  series: number;
  title: string;
  note: string;
}

export function annotatedTimeline(d: ChartData, b: Box, k: Kit): string {
  const xs = d.catNums as number[];
  const valCols = d.series.map((_, i) => i).filter((i) => d.series[i].vals.some(num));
  const textCols = d.series.map((_, i) => i).filter((i) => !d.series[i].vals.some(num));
  const flags: Flag[] = [];
  valCols.forEach((col, n) => {
    const tc = textCols[n * 2];
    const nc = textCols[n * 2 + 1];
    if (tc === undefined && nc === undefined) return;
    xs.forEach((x, r) => {
      const v = d.series[col].vals[r];
      const title = tc === undefined ? '' : d.series[tc].txt[r] ?? '';
      const note = nc === undefined ? '' : d.series[nc].txt[r] ?? '';
      if (num(v) && (title || note)) flags.push({ x, v, series: col, title, note });
    });
  });
  const all = valCols.flatMap((c) => d.series[c].vals.filter(num));
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const lo = Math.min(...all);
  const ys = k.nice(lo >= 0 ? 0 : lo, Math.max(...all), 5);
  const xsc = k.nice(xmin, xmax === xmin ? xmin + 1 : xmax, 6);
  const dates = xsc.min > 20000;
  const fx = (v: number) => (dates ? k.serial(v) : k.fmt(v));
  const lw = Math.max(...ys.ticks.map((t) => k.fmt(t).length)) * 6.4 + 12;
  const rows = flags.length ? 2 : 0;
  const flagH = rows ? rows * 20 + 6 : 0;
  const listN = flags.length && b.h > 200 ? Math.min(3, flags.length) : 0;
  const p: Box = { x: b.x + lw, y: b.y + flagH + 4, w: Math.max(10, b.w - lw - 14), h: Math.max(10, b.h - flagH - 4 - 24 - listN * 14) };
  const px = (v: number) => p.x + ((v - xsc.min) / (xsc.max - xsc.min)) * p.w;
  const py = (v: number) => p.y + p.h - ((v - ys.min) / (ys.max - ys.min)) * p.h;
  const out: string[] = [];
  ys.ticks.forEach((t) => out.push(k.line(p.x, py(t), p.x + p.w, py(t)), k.text(p.x - 5, py(t), k.fmt(t), { anchor: 'end', base: 'central', size: 10 })));
  xsc.ticks.forEach((t) => out.push(k.line(px(t), p.y + p.h, px(t), p.y + p.h + 4, 'stroke-opacity="0.5"'), k.text(px(t), p.y + p.h + 15, fx(t), { size: 10, anchor: px(t) + 32 > b.x + b.w ? 'end' : 'middle' })));
  valCols.forEach((col, n) => {
    const pts = xs.map((x, r) => [x, d.series[col].vals[r]] as const).filter((q): q is readonly [number, number] => num(q[1])).sort((a, c) => a[0] - c[0]);
    if (!pts.length) return;
    out.push(`<path d="${pts.map(([x, v], i) => `${i ? 'L' : 'M'}${k.r1(px(x))} ${k.r1(py(v))}`).join('')}" fill="none" stroke="${k.color(n)}" stroke-width="2" stroke-linejoin="round"/>`);
    if (valCols.length > 1 && pts.length) {
      const [lx, lv] = pts[pts.length - 1];
      out.push(k.text(Math.min(px(lx) + 4, b.x + b.w - 4), py(lv) - 6, d.series[col].name, { anchor: px(lx) + 60 > b.x + b.w ? 'end' : 'start', size: 10, fill: k.color(n) }));
    }
  });
  flags.sort((a, c) => a.x - c.x);
  flags.forEach((f, i) => {
    const x = px(f.x);
    const y = py(f.v);
    const row = i % rows;
    const top = b.y + 3 + row * 20;
    const label = f.title || f.note;
    const cap = label.length > 16 ? `${label.slice(0, 15)}...` : label;
    const wd = Math.min(112, cap.length * 6.1 + 12);
    const left = x + wd > b.x + b.w ? x - wd : x;
    const tip = [f.title, f.note].filter(Boolean).join(': ');
    const col = k.color(valCols.indexOf(f.series));
    out.push(
      `<g class="fc-flag"><title>${k.esc(`${fx(f.x)}  ${tip}`)}</title><path d="M${k.r1(x)} ${k.r1(top + 16)}V${k.r1(y)}" stroke="${col}" stroke-opacity="0.8" stroke-width="1.25" fill="none"/>` +
        `<circle cx="${k.r1(x)}" cy="${k.r1(y)}" r="3.5" fill="${col}" stroke="var(--cell-bg, #fff)" stroke-width="1"/>` +
        `<rect x="${k.r1(left)}" y="${k.r1(top)}" width="${k.r1(wd)}" height="16" rx="3" fill="${col}"/>` +
        `${k.text(left + 6, top + 8, cap, { anchor: 'start', base: 'central', size: 10, fill: '#fff', bold: true })}</g>`,
    );
  });
  flags.slice(0, listN).forEach((f, i) => {
    const t = [f.title, f.note].filter(Boolean).join(': ');
    out.push(k.text(b.x + 4, p.y + p.h + 30 + i * 14, `${fx(f.x)}  ${t.length > 90 ? `${t.slice(0, 89)}...` : t}`, { anchor: 'start', size: 10, op: 0.8 }));
  });
  return out.join('');
}
