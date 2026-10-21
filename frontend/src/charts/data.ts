import type { EngineClient } from '../engine';
import { colName, parseRef, type Range } from '../grid/a1';
import type { ChartData, ChartSpec, ChartType, Series } from './types';

export interface RangeRef {
  sheet: string | null;
  range: Range;
}

export function parseRangeText(text: string): RangeRef | null {
  let s = text.trim();
  let sheet: string | null = null;
  const bang = s.lastIndexOf('!');
  if (bang > 0) {
    sheet = s.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
    s = s.slice(bang + 1);
  }
  const range = parseRef(s.replace(/\$/g, ''));
  return range ? { sheet, range } : null;
}

export function rangeLabel(r: Range): string {
  const a = `${colName(r.c0)}${r.r0 + 1}`;
  return r.r0 === r.r1 && r.c0 === r.c1 ? a : `${a}:${colName(r.c1)}${r.r1 + 1}`;
}

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function numberOf(raw: string): number | null {
  const t = raw.trim();
  if (!t || !NUMERIC.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function textOf(raw: string): string {
  return raw.startsWith("'") ? raw.slice(1) : raw;
}

export type Matrix = string[][];

export async function readMatrix(eng: EngineClient, book: number, sheet: number, r: Range): Promise<Matrix> {
  const h = Math.min(r.r1 - r.r0 + 1, 2000);
  const w = Math.min(r.c1 - r.c0 + 1, 64);
  const m: Matrix = Array.from({ length: h }, () => Array<string>(w).fill(''));
  const cells = await eng.readValues(book, sheet, r.r0, r.c0, r.r0 + h - 1, r.c0 + w - 1);
  for (const [row, col, raw] of cells) {
    const i = row - r.r0;
    const j = col - r.c0;
    if (i >= 0 && i < h && j >= 0 && j < w) m[i][j] = raw;
  }
  return m;
}

function transpose(m: Matrix): Matrix {
  if (!m.length) return m;
  return m[0].map((_, j) => m.map((row) => row[j]));
}

export function shape(m: Matrix): { header: boolean; labels: boolean } {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  if (rows < 1 || cols < 1) return { header: false, labels: false };
  const isNum = (s: string) => numberOf(s) !== null;
  const isText = (s: string) => s !== '' && !isNum(s);
  const body = m.slice(1);
  const labels = cols > 1 && body.length > 0 && body.filter((row) => isText(row[0])).length > body.length / 2 && body.filter((row) => isNum(row[0])).length === 0;
  const dateLabels = cols > 1 && body.length > 1 && !labels && body.every((row) => isNum(row[0])) && m[0].slice(1).every((s) => !isNum(s)) && body.every((row, i) => i === 0 || Number(row[0]) > Number(body[i - 1][0])) && Number(body[0][0]) > 20000;
  const firstRow = m[0].slice(labels || dateLabels ? 1 : 0);
  const header = rows > 1 && firstRow.length > 0 && firstRow.every((s) => !isNum(s)) && firstRow.some((s) => s !== '');
  return { header, labels: labels || dateLabels };
}

export function build(m0: Matrix, byRows: boolean, type: ChartType): ChartData {
  const m = byRows ? transpose(m0) : m0;
  const { header, labels } = shape(m);
  const body = header ? m.slice(1) : m;
  const catCol = labels || type === 'scatter' || type === 'bubble' ? 0 : -1;
  const cats = body.map((row, i) => (catCol >= 0 ? textOf(row[0]) : String(i + 1)));
  const catNums = body.map((row, i) => (catCol >= 0 ? numberOf(row[0]) : i + 1));
  const first = catCol >= 0 ? 1 : 0;
  const width = m[0]?.length ?? 0;
  const series: Series[] = [];
  for (let j = first; j < width; j++) {
    const name = header ? textOf(m[0][j]) || `Series ${series.length + 1}` : `Series ${series.length + 1}`;
    series.push({ name, vals: body.map((row) => numberOf(row[j] ?? '')), txt: body.map((row) => textOf(row[j] ?? '')) });
  }
  if (!series.length && catCol >= 0) series.push({ name: 'Series 1', vals: body.map((row) => numberOf(row[0])), txt: body.map((row) => textOf(row[0])) });
  return { cats, catNums, series };
}

export function recommend(m: Matrix): ChartType[] {
  const { header, labels } = shape(m);
  const body = header ? m.slice(1) : m;
  const cols = m[0]?.length ?? 0;
  const nSeries = Math.max(0, cols - (labels ? 1 : 0));
  const out: ChartType[] = [];
  const dateLike = labels && body.length > 2 && body.every((r) => numberOf(r[0]) !== null);
  const scatterLike = !labels && cols === 2 && body.length > 3 && body.every((r) => numberOf(r[0]) !== null && numberOf(r[1]) !== null);
  if (scatterLike) out.push('scatter', 'line');
  else if (dateLike) out.push('line', 'area', 'column');
  else if (labels && nSeries === 1) {
    out.push(body.length <= 6 ? 'pie' : 'column', body.length <= 6 ? 'column' : 'bar', 'bar');
    if (body.length > 6) out.push('treemap');
  } else if (labels && nSeries > 1) out.push('column', 'line', 'column-stacked', 'bar');
  else if (!labels && nSeries >= 1) out.push(body.length > 12 ? 'histogram' : 'column', 'line');
  else out.push('column');
  if (nSeries === 4 && labels) out.push('candlestick');
  return [...new Set(out)].slice(0, 5);
}

export function spec(range: string, type: ChartType): ChartSpec {
  return { type, range, byRows: false, title: '', xTitle: '', yTitle: '', legend: 'right', labels: false, secondary: [] };
}
