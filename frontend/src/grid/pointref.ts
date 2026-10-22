import { colName } from './a1';

export interface PointSlot {
  start: number;
  end: number;
}

export function pointSlot(text: string, from: number, to: number, prev: PointSlot | null): PointSlot | null {
  if (!text.startsWith('=')) return null;
  if (prev && from === prev.end && to === prev.end) return prev;
  if (from !== to) return null;
  const before = text.slice(0, from).trimEnd();
  if (!before || !/[=(,+\-*/^&<>;:{|]$/.test(before)) return null;
  return { start: from, end: from };
}

export function pointText(r0: number, c0: number, r1: number, c1: number): string {
  const one = `${colName(c0)}${r0 + 1}`;
  return r0 === r1 && c0 === c1 ? one : `${one}:${colName(c1)}${r1 + 1}`;
}
