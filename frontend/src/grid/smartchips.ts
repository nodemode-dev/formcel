export type ChipKind = 'person' | 'file' | 'date' | 'place';

export interface SmartChip {
  kind: ChipKind;
  start: number;
  label: string;
  value: string;
  tip: string;
}

export interface ChipHit {
  x: number;
  y: number;
  w: number;
  h: number;
  chip: SmartChip;
}

const KINDS: ChipKind[] = ['person', 'file', 'date', 'place'];
const PAD = 7;
const GAP = 3;

export const TONES: Record<ChipKind, { fill: string; edge: string; dot: string }> = {
  person: { fill: 'rgba(66,133,244,0.20)', edge: 'rgba(66,133,244,0.55)', dot: '#4285f4' },
  file: { fill: 'rgba(234,67,53,0.17)', edge: 'rgba(234,67,53,0.5)', dot: '#ea4335' },
  date: { fill: 'rgba(154,160,166,0.28)', edge: 'rgba(154,160,166,0.65)', dot: '#80868b' },
  place: { fill: 'rgba(52,168,83,0.20)', edge: 'rgba(52,168,83,0.55)', dot: '#34a853' },
};

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const unesc = (s: string) => s.replace(/\\(.)/g, (_, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));

export function decodeChips(text: string): SmartChip[] {
  const out: SmartChip[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const p = line.split('\t').map(unesc);
    if (p.length < 4 || !KINDS.includes(p[0] as ChipKind)) continue;
    const start = Number(p[1]);
    if (!Number.isInteger(start) || start < 0 || !p[2]) continue;
    out.push({ kind: p[0] as ChipKind, start, label: p[2], value: p[3], tip: p[4] ?? '' });
  }
  return out;
}

export function encodeChips(list: SmartChip[]): string {
  return list.map((c) => [c.kind, String(c.start), c.label, c.value, c.tip].map(esc).join('\t')).join('\n');
}

export function chipHref(c: SmartChip): string | null {
  const v = c.value.trim();
  if (!v) return null;
  if (c.kind === 'person') return v.includes('@') ? `mailto:${v}` : null;
  if (c.kind === 'file') return /^(https?:\/\/|www\.)/i.test(v) ? (v.startsWith('www.') ? `https://${v}` : v) : null;
  if (c.kind === 'place') return /^https?:\/\//i.test(v) ? v : `https://www.openstreetmap.org/search?query=${encodeURIComponent(v)}`;
  return null;
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface Run {
  text: string;
  chip: SmartChip | null;
  width: number;
}

export function runsOf(ctx: CanvasRenderingContext2D, line: string, chips: SmartChip[]): Run[] {
  const runs: Run[] = [];
  const chars = [...line];
  let at = 0;
  for (const c of chips) {
    const len = [...c.label].length;
    if (c.start < at || c.start + len > chars.length) continue;
    if (c.start > at) {
      const t = chars.slice(at, c.start).join('');
      runs.push({ text: t, chip: null, width: ctx.measureText(t).width });
    }
    runs.push({ text: c.label, chip: c, width: ctx.measureText(c.label).width + PAD * 2 + 10 + GAP });
    at = c.start + len;
  }
  if (at < chars.length) {
    const t = chars.slice(at).join('');
    runs.push({ text: t, chip: null, width: ctx.measureText(t).width });
  }
  return runs;
}

export function lineWidth(ctx: CanvasRenderingContext2D, line: string, chips: SmartChip[]): number {
  return runsOf(ctx, line, chips).reduce((n, r) => n + r.width, 0);
}

export function paintChipLine(ctx: CanvasRenderingContext2D, line: string, chips: SmartChip[], x0: number, base: number, px: number, ha: CanvasTextAlign, hits: ChipHit[]): void {
  const runs = runsOf(ctx, line, chips);
  const total = runs.reduce((n, r) => n + r.width, 0);
  let x = ha === 'right' ? x0 - total : ha === 'center' ? x0 - total / 2 : x0;
  const fill = ctx.fillStyle;
  const h = Math.round(px * 1.35);
  const top = Math.round(base - px * 1.02);
  ctx.textAlign = 'left';
  for (const r of runs) {
    if (!r.chip) {
      ctx.fillStyle = fill;
      ctx.fillText(r.text, x, base);
      x += r.width;
      continue;
    }
    const w = r.width - GAP;
    const tone = TONES[r.chip.kind];
    round(ctx, x + 0.5, top + 0.5, w - 1, h - 1, h / 2);
    ctx.fillStyle = tone.fill;
    ctx.fill();
    ctx.strokeStyle = tone.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = tone.dot;
    ctx.beginPath();
    ctx.arc(x + PAD + 2.5, top + h / 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.fillText(r.text, x + PAD + 10, base);
    hits.push({ x, y: top, w, h, chip: r.chip });
    x += r.width;
  }
  ctx.fillStyle = fill;
}
