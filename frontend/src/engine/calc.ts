import type { Arrow } from './protocol';

export type CalcMode = 'auto' | 'tables' | 'manual';

export interface CalcSettings {
  mode: CalcMode;
  style: 'a1' | 'r1c1';
  iterate: boolean;
  iterations: number;
  delta: number;
  threads: number;
  rules: number;
}

export interface CalcStatus {
  mode: CalcMode;
  stale: number;
  circular: number;
  tables: boolean;
  names: string;
}

export interface ErrorFlag {
  row: number;
  col: number;
  rule: number;
  mask: number;
  message: string;
}

export interface SpillInfo {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  legacy: boolean;
}

export interface ExtLink {
  path: string;
  name: string;
  state: 'ok' | 'broken' | 'pending';
  used: number;
  cached: number;
}

export const RULES: [number, string][] = [
  [1, 'Cells containing formulas that result in an error'],
  [2, 'Inconsistent calculated column formula in tables'],
  [4, 'Cells containing years represented as 2 digits'],
  [8, 'Numbers formatted as text or preceded by an apostrophe'],
  [16, 'Formulas inconsistent with other formulas in the region'],
  [32, 'Formulas which omit cells in a region'],
  [64, 'Unlocked cells containing formulas'],
  [128, 'Formulas referring to empty cells'],
  [256, 'Data entered in a table is invalid'],
];

export const FIXES: Record<number, [string, string][]> = {
  8: [['number', 'Convert to Number']],
  4: [['year', 'Convert XX to 20XX or 19XX']],
  32: [['include', 'Update Formula to Include Cells']],
  16: [['above', 'Copy Formula from Above'], ['left', 'Copy Formula from Left'], ['below', 'Copy Formula from Below'], ['right', 'Copy Formula from Right']],
  64: [['lock', 'Lock Cell']],
  2: [['column', 'Restore to Calculated Column Formula']],
};

export function cmd(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r')).join('\t');
}

export function unesc(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) => (c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c));
}

export function parseSettings(text: string): CalcSettings {
  const m = new Map<string, string>();
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i) !== 'ignore') m.set(line.slice(0, i), line.slice(i + 1));
  }
  const mode = m.get('mode');
  return {
    mode: mode === 'manual' || mode === 'tables' ? mode : 'auto',
    style: m.get('style') === 'r1c1' ? 'r1c1' : 'a1',
    iterate: m.get('iterate') === '1',
    iterations: Number(m.get('iterations') ?? 100) || 100,
    delta: Number(m.get('delta') ?? 0.001),
    threads: Number(m.get('threads') ?? 0) || 0,
    rules: Number(m.get('rules') ?? 383),
  };
}

export function withSetting(text: string, key: string, value: string | number): string {
  const lines = text.split('\n').filter(Boolean);
  const at = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (at >= 0) lines[at] = `${key}=${value}`;
  else lines.unshift(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

export function parseStatus(text: string): CalcStatus {
  const [mode, stale, circular, tables, names] = text.split('\t');
  return { mode: mode === 'manual' || mode === 'tables' ? mode : 'auto', stale: Number(stale) || 0, circular: Number(circular) || 0, tables: tables === '1', names: names ?? '' };
}

export function parseFlags(text: string): ErrorFlag[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .map(([r, c, rule, mask, message]) => ({ row: Number(r), col: Number(c), rule: Number(rule), mask: Number(mask), message: unesc(message ?? '') }));
}

export function parseSpill(text: string): SpillInfo | null {
  if (!text) return null;
  const [r0, c0, r1, c1, kind] = text.split('\t');
  return { r0: Number(r0), c0: Number(c0), r1: Number(r1), c1: Number(c1), legacy: kind === 'a' };
}

export function parseAreas(text: string): [number, number, number, number][] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t').map(Number) as [number, number, number, number]);
}

export function parseLinks(text: string): ExtLink[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .map(([path, name, state, used, cached]) => ({ path: unesc(path ?? ''), name: unesc(name ?? ''), state: state === 'broken' || state === 'pending' ? state : 'ok', used: Number(used) || 0, cached: Number(cached) || 0 }));
}

export function parseArrows(text: string): Arrow[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t').map(Number) as Arrow);
}
