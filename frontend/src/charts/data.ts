import type { EngineClient } from '../engine';
import { colName, parseRef, type Range } from '../grid/a1';
import { matched } from './map';
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
  if (type === 'treemap' || type === 'sunburst') {
    const h = hierarchy(m);
    if (h) return h;
  }
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

export interface Recommendation {
  type: ChartType;
  score: number;
  why: string;
}

function leadingText(body: Matrix, width: number): number {
  let k = 0;
  while (k < width) {
    const cells = body.map((r) => r[k] ?? '').filter((s) => s !== '');
    if (!cells.length || cells.some((s) => numberOf(s) !== null)) break;
    k++;
  }
  return k;
}

function hierarchy(m: Matrix): ChartData | null {
  if (m.length < 2) return null;
  const width = m[0].length;
  const header = m[0].every((s) => numberOf(s) === null) && m[0].some((s) => s !== '');
  const body = header ? m.slice(1) : m;
  const k = leadingText(body, width);
  if (k < 2 || k >= width) return null;
  const carry: string[] = [];
  const paths: string[][] = body.map((row) => {
    const path: string[] = [];
    for (let j = 0; j < k; j++) {
      const v = textOf(row[j] ?? '');
      if (v) {
        carry[j] = v;
        for (let q = j + 1; q < k; q++) carry[q] = '';
      }
      path.push(v || (j < k - 1 ? carry[j] ?? '' : ''));
    }
    return path.filter((s) => s !== '');
  });
  const keep = paths.map((p) => p.length > 0);
  const series: Series[] = [];
  for (let j = k; j < width; j++) {
    const rows = body.filter((_, i) => keep[i]);
    series.push({ name: header ? textOf(m[0][j]) || `Series ${series.length + 1}` : `Series ${series.length + 1}`, vals: rows.map((row) => numberOf(row[j] ?? '')), txt: rows.map((row) => textOf(row[j] ?? '')) });
  }
  const kept = paths.filter((_, i) => keep[i]);
  return { cats: kept.map((p) => p[p.length - 1]), catNums: kept.map(() => null), series, paths: kept };
}

export function recommendRanked(m: Matrix): Recommendation[] {
  const { header, labels } = shape(m);
  const body = header ? m.slice(1) : m;
  const cols = m[0]?.length ?? 0;
  const rows = body.length;
  if (!rows || !cols) return [{ type: 'column', score: 10, why: 'Nothing to chart yet' }];
  const nSeries = Math.max(0, cols - (labels ? 1 : 0));
  const first = body.map((r) => r[0] ?? '');
  const k = leadingText(body, cols);
  const numCols = Array.from({ length: cols }, (_, j) => body.map((r) => numberOf(r[j] ?? '')).filter((v): v is number => v !== null));
  const valueCol = numCols[labels ? 1 : 0] ?? [];
  const positive = valueCol.length > 0 && valueCol.every((v) => v >= 0);
  const negatives = valueCol.some((v) => v < 0);
  const decreasing = valueCol.length >= 3 && valueCol.every((v, i) => i === 0 || v <= valueCol[i - 1]);
  const dateLike = labels && rows > 2 && body.every((r) => numberOf(r[0]) !== null);
  const scatterLike = !labels && cols >= 2 && rows > 3 && body.every((r) => numberOf(r[0]) !== null && numberOf(r[1]) !== null);
  const names = m[0].map((s) => s.toLowerCase());
  const geo = labels && rows >= 3 && matched(first) >= Math.max(3, rows * 0.6);
  const orgLike = k >= 2 && rows >= 3 && body.filter((r) => r[1] !== '' && first.includes(r[1])).length >= Math.max(1, (rows - 1) * 0.6);
  const ohlc = nSeries === 4 && ['open', 'high', 'low', 'close'].every((w) => names.some((n) => n.includes(w)));
  const timelineLike = header && k >= 1 && cols >= 3 && /start|begin|from/.test(names.join(' ')) && /end|finish|to|due/.test(names.join(' '));
  const out: Recommendation[] = [];
  const add = (type: ChartType, score: number, why: string) => {
    if (score >= 20) out.push({ type, score, why });
  };
  add('map', geo ? 96 : 0, 'The first column holds country names or codes');
  add('org', orgLike ? 94 : 0, 'The second column names managers from the first');
  add('candlestick', ohlc ? 95 : 0, 'Open, high, low and close columns');
  add('timeline', timelineLike ? 86 : 0, 'Tasks with start and end columns');
  const nested = k >= 2 && cols > k && !orgLike;
  add('treemap', nested ? 90 : labels && nSeries === 1 && positive && rows > 6 ? 50 : 0, nested ? 'Several levels of categories sharing one value' : 'Many positive parts of one whole');
  add('sunburst', nested ? 82 : 0, 'Several levels of categories sharing one value');
  add('scatter', scatterLike ? 92 : 0, 'Two numeric columns, each row a point');
  add('bubble', !labels && cols === 3 && rows > 3 && numCols.every((c) => c.length === rows) ? 70 : 0, 'Three numeric columns: x, y and size');
  add('line', dateLike ? 90 : labels && nSeries >= 1 && rows >= 6 ? (nSeries > 1 ? 66 : 54) : !labels && nSeries >= 1 && rows <= 12 ? 40 : 0, dateLike ? 'Values in date or number order' : 'Trends across categories');
  add('area', dateLike ? 58 : labels && nSeries > 1 ? 44 : 0, 'Totals over time or categories');
  add('column', labels ? (nSeries === 1 ? 82 : 80) : !labels && rows <= 12 ? 70 : 30, 'Compares values across categories');
  add('column-stacked', labels && nSeries >= 2 && nSeries <= 6 && !negatives ? 56 : 0, 'Parts that add up within each category');
  add('bar', labels && (rows > 6 || first.some((s) => s.length > 12)) ? 62 : labels ? 40 : 0, 'Long or many category names read better sideways');
  add('pie', labels && nSeries === 1 && positive && rows >= 2 && rows <= 7 ? 88 : 0, 'A few positive parts of one whole');
  add('doughnut', labels && nSeries === 1 && positive && rows >= 2 && rows <= 7 ? 52 : 0, 'A few positive parts of one whole');
  add('histogram', !labels && nSeries >= 1 && rows > 12 ? 88 : labels && nSeries === 1 && rows > 20 ? 45 : 0, 'Many values: shows how they are distributed');
  add('box', nSeries >= 1 && rows >= 8 && !labels ? 64 : nSeries >= 2 && rows >= 8 ? 50 : 0, 'Compares spread and outliers');
  add('waterfall', labels && nSeries === 1 && negatives ? 84 : labels && nSeries === 1 && rows >= 4 && /total|net|sum/.test(first.join(' ').toLowerCase()) ? 80 : 0, 'Increases and decreases that build to a total');
  add('funnel', labels && nSeries === 1 && decreasing && rows >= 3 && rows <= 9 && positive ? 80 : 0, 'Values shrinking stage by stage');
  add('radar', labels && nSeries >= 2 && nSeries <= 5 && rows >= 3 && rows <= 10 ? 42 : 0, 'Compares several measures per item');
  add('combo', labels && nSeries === 2 && valueCol.length && numCols[2]?.length && Math.max(...numCols[2].map(Math.abs)) > 8 * Math.max(1, ...valueCol.map(Math.abs)) ? 68 : 0, 'Two series on very different scales');
  add('scorecard', rows === 1 && cols <= 2 ? 72 : 0, 'A single number');
  add('gauge', rows === 1 && cols <= 2 ? 62 : 0, 'A single number against a range');
  if (!out.length) add('column', 30, 'Compares values');
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

export function recommend(m: Matrix): ChartType[] {
  return recommendRanked(m).map((r) => r.type);
}

export function spec(range: string, type: ChartType): ChartSpec {
  return { type, range, byRows: false, title: '', xTitle: '', yTitle: '', legend: 'right', labels: false, secondary: [] };
}
