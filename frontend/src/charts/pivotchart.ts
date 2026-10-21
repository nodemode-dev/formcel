import type { EngineClient } from '../engine';
import { outArea, type PivotDef } from '../ui/pivot';
import { readMatrix } from './data';
import type { ChartData, Series } from './types';

export const FILTER_BAR = 28;

const GRAND = 'Grand Total';

function numberOf(raw: string): number | null {
  const t = raw.trim();
  if (!t || !/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function pivotLabel(def: PivotDef, field: string): string {
  const f = def.filters.find((x) => x.field === field);
  if (!f || !f.items.length) return '(All)';
  return f.items.length === 1 ? f.items[0] : '(Multiple Items)';
}

export async function pivotChartData(eng: EngineClient, book: number, def: PivotDef): Promise<ChartData | null> {
  const out = outArea(def);
  if (!out) return null;
  const [r0, c0, r1, c1] = out.area;
  const m = (await readMatrix(eng, book, out.sheet, { r0, c0, r1, c1 })).map((row) => row.map((s) => (s.startsWith("'") ? s.slice(1) : s)));
  const kr = def.rows.length;
  const kc = def.cols.length;
  const nv = def.values.length;
  const skip = def.filters.length ? def.filters.length + 1 : 0;
  const hrows = kc > 0 ? 1 + kc + (nv > 1 ? 1 : 0) : 1;
  const head = m.slice(skip, skip + hrows);
  const body = m.slice(skip + hrows);
  const width = m[0]?.length ?? 0;
  if (!head.length || !body.length || width <= kr) return null;
  const subtotals = def.flags.includes('s');
  const total = (s: string) => s === GRAND || (subtotals && / Total$/.test(s));

  const levels: string[][] = [];
  for (let lv = 0; lv < kc; lv++) {
    const row = head[1 + lv] ?? [];
    const filled: string[] = [];
    let cur = '';
    for (let j = 0; j < width; j++) {
      if (j >= kr && (row[j] ?? '') !== '') cur = row[j];
      else if (j < kr) cur = '';
      filled.push(cur);
    }
    levels.push(filled);
  }
  const valueRow = kc > 0 && nv > 1 ? head[1 + kc] ?? [] : [];
  const cols: { j: number; name: string }[] = [];
  for (let j = kr; j < width; j++) {
    const parts = levels.map((l) => l[j]).filter(Boolean);
    if (parts.some(total)) continue;
    let name: string;
    if (kc === 0) name = head[0][j] ?? '';
    else if (nv > 1) name = [...parts, valueRow[j] ?? ''].filter(Boolean).join(' / ');
    else name = parts.join(' / ') || head[0][0] || 'Value';
    if (kc === 0 && total(name)) continue;
    cols.push({ j, name: name || `Series ${cols.length + 1}` });
  }

  const carry: string[] = [];
  const rows: { label: string; path: string[]; cells: string[] }[] = [];
  for (const row of body) {
    const labels = row.slice(0, kr);
    if (kr > 0 && labels.some(total)) continue;
    if (kr > 0) {
      let seen = false;
      for (let lv = 0; lv < kr; lv++) {
        if (labels[lv] !== '') {
          carry[lv] = labels[lv];
          for (let q = lv + 1; q < kr; q++) carry[q] = '';
          seen = true;
        }
      }
      if (!seen && carry.every((s) => !s)) continue;
    }
    const path = kr > 0 ? carry.slice(0, kr).filter(Boolean) : ['Total'];
    if (kr > 1 && path.length < kr) continue;
    if (!row.slice(kr).some((s) => s !== '')) continue;
    rows.push({ label: path.join(' / '), path: [...path], cells: row });
  }
  if (!rows.length || !cols.length) return null;
  const series: Series[] = cols.map(({ j, name }) => ({
    name,
    vals: rows.map((r) => numberOf(r.cells[j] ?? '')),
    txt: rows.map((r) => r.cells[j] ?? ''),
  }));
  return { cats: rows.map((r) => r.label), catNums: rows.map(() => null), series, paths: kr > 1 ? rows.map((r) => r.path) : undefined };
}
