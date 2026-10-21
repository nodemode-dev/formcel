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
  types: string[];
  line: string;
}

interface Scheme {
  slot: string;
  head: 'fill' | 'line';
  band: number;
  dark?: boolean;
}

const SLOT_NAMES = ['dk1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

function builtin(): [string, string, Scheme][] {
  const out: [string, string, Scheme][] = [];
  const add = (kind: string, n: number, slot: number, s: Omit<Scheme, 'slot'>) => out.push([`TableStyle${kind}${n}`, `${kind} ${n}`, { slot: SLOT_NAMES[slot], ...s }]);
  for (let n = 1; n <= 21; n++) {
    if (n <= 7) add('Light', n, n - 1, { head: 'line', band: 85 });
    else if (n <= 14) add('Light', n, n - 8, { head: 'fill', band: 0 });
    else add('Light', n, n - 15, { head: 'line', band: 80 });
  }
  for (let n = 1; n <= 28; n++) {
    const slot = (n - 1) % 7;
    const band = n <= 7 ? 80 : n <= 14 ? 60 : n <= 21 ? 70 : 80;
    add('Medium', n, slot, { head: 'fill', band });
  }
  for (let n = 1; n <= 11; n++) add('Dark', n, n <= 7 ? n - 1 : n - 8, { head: 'fill', band: 25, dark: true });
  return out;
}

export const TABLE_STYLES: [string, string, Scheme][] = builtin();

export interface CustomStyle {
  name: string;
  head: string;
  band: string;
  text: string;
}

export const customId = (c: CustomStyle) => `Custom:${c.name.replace(/[:\t\n]/g, ' ').trim().slice(0, 40)}:${c.head}:${c.band}:${c.text}`;

export function parseCustom(id: string): CustomStyle | null {
  const m = /^Custom:([^:]+):([0-9a-fA-F]{6}):([0-9a-fA-F]{6}):([0-9a-fA-F]{6})$/.exec(id);
  return m ? { name: m[1], head: m[2], band: m[3], text: m[4] } : null;
}

const unesc = (s: string) => s.replace(/\\(.)/g, (_, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));

export function parseTable(line: string): TableInfo | null {
  const p = line.split('\t').map(unesc);
  const n = Number(p[5]);
  const a = (p[2] ?? '').split(',').map(Number);
  if (a.length !== 4 || !Number.isFinite(n)) return null;
  return { sheet: Number(p[0]), name: p[1], area: [a[0], a[1], a[2], a[3]], flags: p[3] ?? '', style: p[4] ?? '', cols: p.slice(6, 6 + n), calc: p.slice(6 + n, 6 + 2 * n), kept: p.slice(6 + 2 * n, 6 + 3 * n), types: p.length >= 6 + 4 * n ? p.slice(6 + 3 * n, 6 + 4 * n) : [], line };
}

export interface TablePaint {
  bg?: string;
  fc?: string;
  b: boolean;
}

export function tablePaint(t: TableInfo, r: number, c: number, look: Look): TablePaint | null {
  const [r0, c0, r1, c1] = t.area;
  if (r < r0 || r > r1 || c < c0 || c > c1) return null;
  if (t.style === 'None') return { b: t.flags.includes('f') && c === c0 ? true : r === r0 };
  const custom = parseCustom(t.style);
  if (custom) {
    const totals = t.flags.includes('t');
    if (r === r0) return { bg: `#${custom.head}`, fc: `#${custom.text}`, b: true };
    if (totals && r === r1) return { b: true };
    const odd = (r - r0 - 1) % 2 === 0;
    return { bg: t.flags.includes('r') && odd ? `#${custom.band}` : undefined, b: (t.flags.includes('f') && c === c0) || (t.flags.includes('l') && c === c1) };
  }
  const scheme = (TABLE_STYLES.find(([id]) => id === t.style) ?? TABLE_STYLES.find(([id]) => id === 'TableStyleMedium2')!)[2];
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
