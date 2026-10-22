export type TypedKind = 'stock' | 'currency';

export interface TypedMark {
  kind: TypedKind;
  label: string;
  payload: string;
  resolved: boolean;
}

export const TYPE_PAD = 17;
const KINDS: TypedKind[] = ['stock', 'currency'];
const TONE: Record<TypedKind | 'unknown', string> = { stock: '#2f6fd0', currency: '#1f9d6a', unknown: '#c0841a' };

const unesc = (s: string) => s.replace(/\\(.)/g, (_, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));

export function decodeTyped(text: string): TypedMark | null {
  for (const line of text.split('\n')) {
    const p = line.split('\t').map(unesc);
    if (p.length < 4 || !KINDS.includes(p[0] as TypedKind) || !p[2]) continue;
    const head = p[3].split('\n', 1)[0].split('\t');
    return { kind: p[0] as TypedKind, label: p[2], payload: p[3], resolved: (head[1] ?? '') !== '' };
  }
  return null;
}

export function paintTypeIcon(ctx: CanvasRenderingContext2D, m: TypedMark, x: number, y: number, rh: number): void {
  const size = 12;
  const top = Math.round(y + (rh - size) / 2);
  const color = TONE[m.resolved ? m.kind : 'unknown'];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.roundRect(x + 0.5, top + 0.5, size - 1, size - 1, 2.5);
  ctx.stroke();
  ctx.beginPath();
  if (!m.resolved) {
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + size / 2, top + size / 2 + 0.5);
  } else if (m.kind === 'stock') {
    ctx.moveTo(x + 2.8, top + 8.4);
    ctx.lineTo(x + 5, top + 5.6);
    ctx.lineTo(x + 6.8, top + 7);
    ctx.lineTo(x + 9.2, top + 3.6);
    ctx.stroke();
  } else {
    ctx.moveTo(x + 3, top + 4.6);
    ctx.lineTo(x + 9, top + 4.6);
    ctx.moveTo(x + 7.4, top + 3);
    ctx.lineTo(x + 9, top + 4.6);
    ctx.lineTo(x + 7.4, top + 6.2);
    ctx.moveTo(x + 9, top + 7.6);
    ctx.lineTo(x + 3, top + 7.6);
    ctx.moveTo(x + 4.6, top + 6);
    ctx.lineTo(x + 3, top + 7.6);
    ctx.lineTo(x + 4.6, top + 9.2);
    ctx.stroke();
  }
  ctx.restore();
}
