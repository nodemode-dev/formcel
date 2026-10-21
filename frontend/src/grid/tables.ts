import type { Border, Line, Look } from './style';
import { PRESET } from './tablestyledata';

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

interface Tint {
  theme: number;
  tint: number;
}

interface Dxf {
  fill?: Tint;
  color?: Tint;
  bold: boolean;
  edges: Partial<Record<'L' | 'R' | 'T' | 'B' | 'V' | 'H', [Line, Tint]>>;
}

const LINES: Record<string, Line> = { t: 'thin', m: 'medium', d: 'double', k: 'thick' };
const THEME_SLOT = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9];

export const TABLE_STYLES: [string, string][] = [
  ...Array.from({ length: 21 }, (_, i): [string, string] => [`TableStyleLight${i + 1}`, `Light ${i + 1}`]),
  ...Array.from({ length: 28 }, (_, i): [string, string] => [`TableStyleMedium${i + 1}`, `Medium ${i + 1}`]),
  ...Array.from({ length: 11 }, (_, i): [string, string] => [`TableStyleDark${i + 1}`, `Dark ${i + 1}`]),
];

const EXACT: Record<number, number> = {
  15: 0.14999847407452621,
  25: 0.249977111117893,
  40: 0.39997558519241921,
  45: 0.44999542222357858,
  50: 0.499984740745262,
  60: 0.59999389629810485,
  80: 0.79998168889431442,
  35: 0.34998626667073579,
};

const tintOf = (s: string): Tint => {
  const m = /^(\d)([+-]\d+)?$/.exec(s) ?? ['', '1'];
  const pct = m[2] ? Number(m[2]) : 0;
  return { theme: Number(m[1]), tint: Math.sign(pct) * (EXACT[Math.abs(pct)] ?? Math.abs(pct) / 100) };
};

const parsed = new Map<string, Map<string, Dxf>>();

function elements(key: string): Map<string, Dxf> | null {
  const hit = parsed.get(key);
  if (hit) return hit;
  const src = PRESET[key];
  if (!src) return null;
  const out = new Map<string, Dxf>();
  for (const part of src.split(';')) {
    const at = part.indexOf('=');
    const dxf: Dxf = { bold: false, edges: {} };
    for (const tok of part.slice(at + 1).split(' ').filter(Boolean)) {
      if (tok === 'b') dxf.bold = true;
      else if (tok[0] === 'c') dxf.color = tintOf(tok.slice(1));
      else if (tok[0] === 'f') dxf.fill = tintOf(tok.slice(1));
      else dxf.edges[tok[0] as 'L'] = [LINES[tok[1]] ?? 'thin', tintOf(tok.slice(2))];
    }
    out.set(part.slice(0, at), dxf);
  }
  parsed.set(key, out);
  return out;
}

const tinted = new Map<string, string>();

function themed(look: Look, t: Tint): string {
  const hex = look.colors[THEME_SLOT[t.theme] ?? 0] ?? '#000000';
  if (!t.tint) return hex;
  const key = `${hex}${t.tint}`;
  let out = tinted.get(key);
  if (!out) {
    out = tintHex(hex, t.tint);
    tinted.set(key, out);
  }
  return out;
}

function tintHex(hex: string, tint: number): string {
  const t = { tint };
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  let l = (hi + lo) / 2;
  const d = hi - lo;
  let h = 0;
  let s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
    h = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = t.tint < 0 ? l * (1 + t.tint) : l * (1 - t.tint) + t.tint;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (x: number) => {
    const u = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
    const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
    return Math.round(v * 255);
  };
  const [R, G, B] = s ? [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)] : [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
  return `#${((R << 16) | (G << 8) | B).toString(16).padStart(6, '0')}`;
}

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
  borders?: (Border | null)[];
}

export function tablePaint(t: TableInfo, r: number, c: number, look: Look): TablePaint | null {
  const [r0, c0, r1, c1] = t.area;
  if (r < r0 || r > r1 || c < c0 || c > c1) return null;
  const head = !t.flags.includes('n');
  if (t.style === 'None') return { b: t.flags.includes('f') && c === c0 ? true : head && r === r0 };
  const custom = parseCustom(t.style);
  if (custom) {
    const totals = t.flags.includes('t');
    if (head && r === r0) return { bg: `#${custom.head}`, fc: `#${custom.text}`, b: true };
    if (totals && r === r1) return { b: true };
    const odd = (r - r0 - (head ? 1 : 0)) % 2 === 0;
    return { bg: t.flags.includes('r') && odd ? `#${custom.band}` : undefined, b: (t.flags.includes('f') && c === c0) || (t.flags.includes('l') && c === c1) };
  }
  const els = elements(t.style.replace(/^TableStyle/, '')) ?? elements('Medium2')!;
  const totals = t.flags.includes('t');
  const d0 = r0 + (head ? 1 : 0);
  const d1 = r1 - (totals ? 1 : 0);
  const isHead = head && r === r0;
  const isTotal = totals && r === r1;
  const data = !isHead && !isTotal;
  const chain: [string, [number, number, number, number]][] = [['W', [r0, c0, r1, c1]]];
  if (data && t.flags.includes('c')) chain.push([(c - c0) % 2 === 0 ? 'C1' : 'C2', [d0, c, d1, c]]);
  if (data && t.flags.includes('r')) chain.push([(r - d0) % 2 === 0 ? 'R1' : 'R2', [r, c0, r, c1]]);
  if (t.flags.includes('f')) chain.push(['FC', [r0, c0, r1, c0]]);
  if (t.flags.includes('l')) chain.push(['LC', [r0, c1, r1, c1]]);
  if (isHead) chain.push(['H', [r0, c0, r0, c1]]);
  if (isTotal) chain.push(['T', [r1, c0, r1, c1]]);
  if (isHead && c === c0) chain.push(['FH', [r0, c0, r0, c0]]);
  if (isHead && c === c1) chain.push(['LH', [r0, c1, r0, c1]]);
  if (isTotal && c === c0) chain.push(['FT', [r1, c0, r1, c0]]);
  if (isTotal && c === c1) chain.push(['LT', [r1, c1, r1, c1]]);
  let bg: string | undefined;
  let fc: string | undefined;
  let b = false;
  const borders: (Border | null)[] = [null, null, null, null];
  for (const [type, [a0, b0, a1, b1]] of chain) {
    const x = els.get(type);
    if (!x) continue;
    if (x.fill) bg = themed(look, x.fill);
    if (x.color) fc = x.color.theme === 1 && !x.color.tint ? undefined : themed(look, x.color);
    if (x.bold) b = true;
    for (const [side, [line, col]] of Object.entries(x.edges)) {
      const edge: Border = { line, color: themed(look, col) };
      if (side === 'T' && r === a0) borders[0] = edge;
      else if (side === 'R' && c === b1) borders[1] = edge;
      else if (side === 'B' && r === a1) borders[2] = edge;
      else if (side === 'L' && c === b0) borders[3] = edge;
      else if (side === 'V' && c < b1) borders[1] = edge;
      else if (side === 'H' && r < a1) borders[2] = edge;
    }
  }
  return { bg, fc, b, borders };
}
