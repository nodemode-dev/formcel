import type { Axis } from '../grid/axis';
import type { Anchor, FloatObject } from './types';

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

function pin(axis: Axis, px: number): [number, number] {
  const i = axis.indexAt(Math.max(0, px));
  return [i, Math.max(0, Math.round((px - axis.offsetOf(i)) * 100) / 100)];
}

export function anchorOf(rows: Axis, cols: Axis, f: Frame): Anchor {
  const [r0, dy0] = pin(rows, f.y);
  const [c0, dx0] = pin(cols, f.x);
  const [r1, dy1] = pin(rows, f.y + f.h);
  const [c1, dx1] = pin(cols, f.x + f.w);
  return { r0, c0, dy0, dx0, r1, c1, dy1, dx1 };
}

export function frameOf(rows: Axis, cols: Axis, a: Anchor): Frame {
  const x = cols.offsetOf(a.c0) + a.dx0;
  const y = rows.offsetOf(a.r0) + a.dy0;
  const w = cols.offsetOf(a.c1) + a.dx1 - x;
  const h = rows.offsetOf(a.r1) + a.dy1 - y;
  return { x, y, w: Math.max(8, w), h: Math.max(8, h) };
}

export function toLine(o: FloatObject): string {
  const a = o.anchor!;
  const { anchor: _drop, ...rest } = o;
  return [o.id, a.r0, a.c0, a.dy0, a.dx0, a.r1, a.c1, a.dy1, a.dx1, JSON.stringify(rest)].join('\t');
}

export function fromLine(line: string): FloatObject | null {
  const p = line.split('\t');
  if (p.length < 10) return null;
  const n = p.slice(1, 9).map(Number);
  if (n.some((v) => !Number.isFinite(v))) return null;
  try {
    const obj = JSON.parse(p.slice(9).join('\t')) as FloatObject;
    obj.id = p[0];
    obj.anchor = { r0: n[0], c0: n[1], dy0: n[2], dx0: n[3], r1: n[4], c1: n[5], dy1: n[6], dx1: n[7] };
    return obj;
  } catch {
    return null;
  }
}
