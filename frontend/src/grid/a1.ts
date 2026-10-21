export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

export interface Range {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function colName(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function a1(row: number, col: number): string {
  return `${colName(col)}${row + 1}`;
}

export function rangeText(r: Range): string {
  return r.r0 === r.r1 && r.c0 === r.c1 ? a1(r.r0, r.c0) : `${a1(r.r0, r.c0)}:${a1(r.r1, r.c1)}`;
}

function cell(s: string): [number, number] | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  if (row < 1 || row > MAX_ROWS || col < 1 || col > MAX_COLS) return null;
  return [row - 1, col - 1];
}

export function parseRef(s: string): Range | null {
  const [a, b] = s.split(':');
  const p = cell(a ?? '');
  if (!p) return null;
  const q = b === undefined ? p : cell(b);
  if (!q) return null;
  return { r0: Math.min(p[0], q[0]), c0: Math.min(p[1], q[1]), r1: Math.max(p[0], q[0]), c1: Math.max(p[1], q[1]) };
}
