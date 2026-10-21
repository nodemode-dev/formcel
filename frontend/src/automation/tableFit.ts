import { parseTable, type TableInfo } from '../grid/tables';

const fieldEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

export function findTable(lines: string[], sheet: number, name: string | undefined, r0: number, c0: number): TableInfo | null {
  const all = lines.map(parseTable).filter((t): t is TableInfo => !!t && t.sheet === sheet);
  return all.find((t) => !!name && t.name === name) ?? all.find((t) => t.area[0] === r0 && t.area[1] === c0) ?? null;
}

export function needsResize(t: TableInfo, r1: number, c1: number): boolean {
  return !t.flags.includes('t') && (t.area[2] !== r1 || t.area[3] !== c1);
}

export function resizedLine(t: TableInfo, r1: number, c1: number): string {
  const w = c1 - t.area[1] + 1;
  const pad = (list: string[]) => Array.from({ length: w }, (_, i) => list[i] ?? '');
  const parts = [t.name, `${t.area[0]},${t.area[1]},${r1},${c1}`, t.flags, t.style, String(w), ...pad(t.cols), ...pad(t.calc), ...pad(t.kept)];
  if (t.types.some(Boolean)) parts.push(...pad(t.types));
  return parts.map(fieldEsc).join('\t');
}
