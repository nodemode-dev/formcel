import { paint, tint, type Look } from './style';

export interface TableInfo {
  name: string;
  sheet: number;
  area: [number, number, number, number];
  flags: string;
  style: string;
  cols: string[];
  calc: string[];
  kept: string[];
  line: string;
}

interface Scheme {
  slot: string;
  head: 'fill' | 'line';
  band: number;
  dark?: boolean;
}

export const TABLE_STYLES: [string, string, Scheme][] = [
  ['TableStyleLight1', 'Light 1', { slot: 'dk1', head: 'line', band: 85 }],
  ['TableStyleLight9', 'Light 9', { slot: 'accent1', head: 'fill', band: 0 }],
  ['TableStyleLight15', 'Light 15', { slot: 'accent5', head: 'line', band: 80 }],
  ['TableStyleMedium2', 'Medium 2', { slot: 'accent1', head: 'fill', band: 80 }],
  ['TableStyleMedium4', 'Medium 4', { slot: 'accent3', head: 'fill', band: 80 }],
  ['TableStyleMedium9', 'Medium 9', { slot: 'accent1', head: 'fill', band: 60 }],
  ['TableStyleMedium14', 'Medium 14', { slot: 'accent6', head: 'fill', band: 60 }],
  ['TableStyleDark1', 'Dark 1', { slot: 'dk1', head: 'fill', band: 25, dark: true }],
];

const unesc = (s: string) => s.replace(/\\(.)/g, (_, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));

export function parseTable(line: string): TableInfo | null {
  const p = line.split('\t').map(unesc);
  const n = Number(p[5]);
  const a = (p[2] ?? '').split(',').map(Number);
  if (a.length !== 4 || !Number.isFinite(n)) return null;
  return { sheet: Number(p[0]), name: p[1], area: [a[0], a[1], a[2], a[3]], flags: p[3] ?? '', style: p[4] ?? '', cols: p.slice(6, 6 + n), calc: p.slice(6 + n, 6 + 2 * n), kept: p.slice(6 + 2 * n, 6 + 3 * n), line };
}

export interface TablePaint {
  bg?: string;
  fc?: string;
  b: boolean;
}

export function tablePaint(t: TableInfo, r: number, c: number, look: Look): TablePaint | null {
  const [r0, c0, r1, c1] = t.area;
  if (r < r0 || r > r1 || c < c0 || c > c1) return null;
  const scheme = (TABLE_STYLES.find(([id]) => id === t.style) ?? TABLE_STYLES[3])[2];
  const base = paint(`t:${scheme.slot}`, look);
  const totals = t.flags.includes('t');
  if (r === r0) return scheme.head === 'fill' ? { bg: base, fc: '#ffffff', b: true } : { b: true };
  if (totals && r === r1) return { b: true, bg: scheme.dark ? base : undefined, fc: scheme.dark ? '#ffffff' : undefined };
  const edge = (t.flags.includes('f') && c === c0) || (t.flags.includes('l') && c === c1);
  const i = r - r0 - 1;
  const j = c - c0;
  const banded = (t.flags.includes('r') && i % 2 === 0) || (t.flags.includes('c') && j % 2 === 0);
  const bg = scheme.band && banded ? tint(base, scheme.band) : scheme.dark ? tint(base, 45) : undefined;
  return { bg, fc: scheme.dark ? '#ffffff' : undefined, b: edge };
}
