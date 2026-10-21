import type { SparkSpec } from './types';

export type Series = (number | null)[];

export interface Bounds {
  lo: number;
  hi: number;
}

const POINT = 2.2;

export function groupKey(s: SparkSpec): string {
  const { dataId: _a, data: _b, ...rest } = s;
  return JSON.stringify(rest);
}

export function toSeries(raw: string[], empty: SparkSpec['empty']): Series {
  return raw.map((t) => {
    const s = t.trim();
    if (s === '' || !/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return empty === 'zero' ? 0 : null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  });
}

export function boundsOf(vals: Series): Bounds | null {
  const nums = vals.filter((v): v is number => v !== null);
  return nums.length ? { lo: Math.min(...nums), hi: Math.max(...nums) } : null;
}

function resolve(spec: SparkSpec, own: Bounds, group: Bounds | null): Bounds {
  const pick = (v: SparkSpec['min'], fallback: number, g: number | undefined) => (typeof v === 'number' ? v : v === 'group' && g !== undefined ? g : fallback);
  return { lo: pick(spec.min, own.lo, group?.lo), hi: pick(spec.max, own.hi, group?.hi) };
}

export function drawSparkGroup(ctx: CanvasRenderingContext2D, spec: SparkSpec, vals: Series, left: number, top: number, width: number, height: number, group: Bounds | null): void {
  const own = boundsOf(vals);
  if (!own || width < 8 || height < 6) return;
  const x0 = left + 3;
  const w = Math.max(4, width - 6);
  const y0 = top + 3;
  const h = Math.max(4, height - 6);
  const n = vals.length;
  const color = spec.color || '#376092';
  const neg = spec.neg || '#d00000';
  const nums = vals.filter((v): v is number => v !== null);
  const hiVal = Math.max(...nums);
  const loVal = Math.min(...nums);
  const firstIdx = vals.findIndex((v) => v !== null);
  const lastIdx = vals.length - 1 - [...vals].reverse().findIndex((v) => v !== null);
  const paint = (i: number, v: number): string => {
    if (spec.high && v === hiVal && i === vals.indexOf(hiVal)) return spec.highColor || '#d00000';
    if (spec.low && v === loVal && i === vals.indexOf(loVal)) return spec.lowColor || '#d00000';
    if (spec.first && i === firstIdx) return spec.firstColor || '#d00000';
    if (spec.last && i === lastIdx) return spec.lastColor || '#d00000';
    if (spec.negative && v < 0) return neg;
    return color;
  };
  const marked = (i: number, v: number): boolean => paint(i, v) !== color || !!spec.markers;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left + 1, top, width - 2, height);
  ctx.clip();
  if (spec.type === 'line') {
    const b = resolve(spec, own, group);
    const span = b.hi - b.lo || 1;
    const px = (i: number) => x0 + (n === 1 ? w / 2 : (i / (n - 1)) * w);
    const py = (v: number) => y0 + h - ((Math.max(b.lo, Math.min(b.hi, v)) - b.lo) / span) * h;
    if (spec.axis && b.lo < 0 && b.hi > 0) {
      ctx.strokeStyle = spec.axisColor || '#888888';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, py(0));
      ctx.lineTo(x0 + w, py(0));
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = spec.weight || 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        if (spec.empty !== 'span') pen = false;
        return;
      }
      if (pen) ctx.lineTo(px(i), py(v));
      else ctx.moveTo(px(i), py(v));
      pen = true;
    });
    ctx.stroke();
    vals.forEach((v, i) => {
      if (v === null || !marked(i, v)) return;
      ctx.fillStyle = spec.markers && paint(i, v) === color ? spec.markerColor || '#d00000' : paint(i, v);
      ctx.fillRect(px(i) - POINT, py(v) - POINT, POINT * 2, POINT * 2);
    });
  } else {
    const win = spec.type === 'winloss';
    const b = win ? { lo: -1, hi: 1 } : resolve(spec, own, group);
    const lo = Math.min(b.lo, 0);
    const hi = Math.max(b.hi, 0);
    const span = hi - lo || 1;
    const base = y0 + h - ((0 - lo) / span) * h;
    const bw = w / n;
    if (spec.axis && (win || (lo < 0 && hi > 0))) {
      ctx.strokeStyle = spec.axisColor || '#888888';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, base);
      ctx.lineTo(x0 + w, base);
      ctx.stroke();
    }
    vals.forEach((v, i) => {
      if (v === null) return;
      const val = win ? Math.sign(v) : Math.max(lo, Math.min(hi, v));
      if (!val) return;
      const yy = y0 + h - ((val - lo) / span) * h;
      const col = val < 0 && !spec.negative ? neg : paint(i, v);
      ctx.fillStyle = val < 0 && col === color ? neg : col;
      const bh = win ? h * 0.42 : Math.max(1, Math.abs(base - yy));
      const top2 = win ? (val > 0 ? base - bh : base) : Math.min(yy, base);
      ctx.fillRect(x0 + i * bw + 0.5, top2, Math.max(1, bw - 1), bh);
    });
  }
  ctx.restore();
}
