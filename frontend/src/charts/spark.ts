import { PALETTE } from './types';

export const SPARK_CODE = 0xe000;

const NAMED: Record<string, string> = { red: '#e15759', green: '#59a14f', blue: '#4e79a7', orange: '#f28e2b', purple: '#b07aa1', gray: '#8c8c8c', grey: '#8c8c8c', black: '#222222', yellow: '#edc948', teal: '#76b7b2' };

function css(c: string, fallback: string): string {
  const t = c.trim().toLowerCase();
  if (!t) return fallback;
  return NAMED[t] ?? (/^#[0-9a-f]{3,8}$/.test(t) ? t : fallback);
}

export function drawSpark(ctx: CanvasRenderingContext2D, text: string, left: number, right: number, top: number, height: number, fg: string): boolean {
  const f = text.split('\t');
  if (f[0].slice(1) !== 'SPK' || f.length < 8) return false;
  const [, kind, colorText, negText, loText, hiText, widthText, data] = f;
  const vals = data.split(',').map((s) => (s === '' ? null : Number(s)));
  const nums = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!nums.length) return true;
  const color = css(colorText, PALETTE[0]);
  const neg = css(negText, '#e15759');
  const x0 = left + 4;
  const w = Math.max(4, right - left - 8);
  const y0 = top + 3;
  const h = Math.max(4, height - 6);
  const lo0 = loText === '' ? Math.min(...nums) : Number(loText);
  const hi0 = hiText === '' ? Math.max(...nums) : Number(hiText);
  const n = vals.length;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left + 1, top, right - left - 2, height);
  ctx.clip();
  if (kind === 'bar') {
    const total = nums.reduce((a, v) => a + Math.max(0, v), 0) || 1;
    let x = x0;
    nums.forEach((v, i) => {
      const seg = (Math.max(0, v) / total) * w;
      ctx.fillStyle = i === 0 ? color : PALETTE[i % PALETTE.length];
      ctx.fillRect(x, y0 + h * 0.25, Math.max(0, seg - 1), h * 0.5);
      x += seg;
    });
  } else if (kind === 'column' || kind === 'winloss') {
    const lo = kind === 'winloss' ? -1 : Math.min(lo0, 0);
    const hi = kind === 'winloss' ? 1 : Math.max(hi0, 0);
    const span = hi - lo || 1;
    const base = y0 + h - ((0 - lo) / span) * h;
    const bw = w / n;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return;
      const val = kind === 'winloss' ? Math.sign(v) : Math.max(lo, Math.min(hi, v));
      if (!val) return;
      const y = y0 + h - ((val - lo) / span) * h;
      ctx.fillStyle = val < 0 ? neg : color;
      ctx.fillRect(x0 + i * bw + 0.5, Math.min(y, base), Math.max(1, bw - 1), Math.max(1, Math.abs(base - y)));
    });
  } else {
    const span = hi0 - lo0 || 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = Number(widthText) || 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      const x = x0 + (n === 1 ? w / 2 : (i / (n - 1)) * w);
      const y = y0 + h - ((Math.max(lo0, Math.min(hi0, v)) - lo0) / span) * h;
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    });
    ctx.stroke();
  }
  ctx.fillStyle = fg;
  ctx.restore();
  return true;
}
