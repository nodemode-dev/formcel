import type { Cell, ChartPatch, Op, PivotPatch, Snapshot } from './officeTypes';

export const ENUMS = {
  BorderIndex: { edgeTop: 'EdgeTop', edgeBottom: 'EdgeBottom', edgeLeft: 'EdgeLeft', edgeRight: 'EdgeRight', insideVertical: 'InsideVertical', insideHorizontal: 'InsideHorizontal', diagonalDown: 'DiagonalDown', diagonalUp: 'DiagonalUp' },
  BorderLineStyle: { none: 'None', continuous: 'Continuous', dash: 'Dash', dashDot: 'DashDot', dashDotDot: 'DashDotDot', dot: 'Dot', double: 'Double', slantDashDot: 'SlantDashDot' },
  BorderWeight: { hairline: 'Hairline', thin: 'Thin', medium: 'Medium', thick: 'Thick' },
  HorizontalAlignment: { general: 'General', left: 'Left', center: 'Center', right: 'Right', fill: 'Fill', justify: 'Justify', centerAcrossSelection: 'CenterAcrossSelection', distributed: 'Distributed' },
  VerticalAlignment: { top: 'Top', center: 'Center', bottom: 'Bottom', justify: 'Justify', distributed: 'Distributed' },
  RangeUnderlineStyle: { none: 'None', single: 'Single', double: 'Double', singleAccountant: 'SingleAccountant', doubleAccountant: 'DoubleAccountant' },
  InsertShiftDirection: { down: 'Down', right: 'Right' },
  DeleteShiftDirection: { up: 'Up', left: 'Left' },
  ClearApplyTo: { all: 'All', formats: 'Formats', contents: 'Contents', hyperlinks: 'Hyperlinks', removeHyperlinks: 'RemoveHyperlinks' },
  RangeCopyType: { all: 'All', formulas: 'Formulas', values: 'Values', formats: 'Formats', link: 'Link' },
  SheetVisibility: { visible: 'Visible', hidden: 'Hidden', veryHidden: 'VeryHidden' },
  SortOrientation: { rows: 'Rows', columns: 'Columns' },
  SortMethod: { pinYin: 'PinYin', strokeCount: 'StrokeCount' },
  ChartSeriesBy: { auto: 'Auto', columns: 'Columns', rows: 'Rows' },
  ChartLegendPosition: { invalid: 'Invalid', top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right', corner: 'Corner', custom: 'Custom' },
  ChartType: {
    invalid: 'Invalid', columnClustered: 'ColumnClustered', columnStacked: 'ColumnStacked', columnStacked100: 'ColumnStacked100', barClustered: 'BarClustered', barStacked: 'BarStacked', barStacked100: 'BarStacked100', line: 'Line', lineMarkers: 'LineMarkers',
    area: 'Area', areaStacked: 'AreaStacked', areaStacked100: 'AreaStacked100', pie: 'Pie', doughnut: 'Doughnut', xyscatter: 'XYScatter', bubble: 'Bubble', radar: 'Radar', histogram: 'Histogram', boxwhisker: 'BoxWhisker', waterfall: 'Waterfall', funnel: 'Funnel',
    treemap: 'Treemap', sunburst: 'Sunburst', regionMap: 'RegionMap',
  },
  AggregationFunction: { automatic: 'Automatic', sum: 'Sum', count: 'Count', average: 'Average', max: 'Max', min: 'Min', product: 'Product', countNumbers: 'CountNumbers', standardDeviation: 'StandardDeviation', standardDeviationP: 'StandardDeviationP', variance: 'Variance', varianceP: 'VarianceP' },
  CalculationType: { recalculate: 'Recalculate', full: 'Full', fullRebuild: 'FullRebuild' },
  DataValidationType: { none: 'None', wholeNumber: 'WholeNumber', decimal: 'Decimal', list: 'List', date: 'Date', time: 'Time', textLength: 'TextLength', custom: 'Custom' },
  DataValidationOperator: { between: 'Between', notBetween: 'NotBetween', equalTo: 'EqualTo', notEqualTo: 'NotEqualTo', greaterThan: 'GreaterThan', lessThan: 'LessThan', greaterThanOrEqualTo: 'GreaterThanOrEqualTo', lessThanOrEqualTo: 'LessThanOrEqualTo' },
  DataValidationAlertStyle: { stop: 'Stop', warning: 'Warning', information: 'Information' },
  TableStyleName: { light1: 'TableStyleLight1', medium2: 'TableStyleMedium2', dark1: 'TableStyleDark1' },
} as const;

const COL_PX = 100;
const ROW_PX = 24;
const MAX_ROW = 1048575;
const MAX_COL = 16383;
const KEY = 16384;

type Scalar = string | number | boolean;

const NAMED: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', orange: 'ffa500', purple: '800080', gray: '808080', grey: '808080', silver: 'c0c0c0', pink: 'ffc0cb', brown: 'a52a2a', cyan: '00ffff', magenta: 'ff00ff',
  lime: '00ff00', navy: '000080', teal: '008080', maroon: '800000', olive: '808000', gold: 'ffd700', lightgray: 'd3d3d3', lightgrey: 'd3d3d3', darkgray: 'a9a9a9', darkblue: '00008b', darkgreen: '006400', darkred: '8b0000', lightblue: 'add8e6', lightgreen: '90ee90', lightyellow: 'ffffe0', skyblue: '87ceeb', coral: 'ff7f50', salmon: 'fa8072', violet: 'ee82ee', indigo: '4b0082', turquoise: '40e0d0', tan: 'd2b48c', beige: 'f5f5dc',
};

export function hexOf(c: string): string {
  const t = String(c).trim().toLowerCase();
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(t);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  const h = t.replace(/^#/, '');
  if (/^[0-9a-f]{6}$/.test(h)) return h;
  if (/^[0-9a-f]{3}$/.test(h)) return h.split('').map((x) => x + x).join('');
  const n = NAMED[t.replace(/\s+/g, '')];
  if (n) return n;
  throw new Error(`${c} is not a colour. Use "#RRGGBB", rgb(r, g, b) or a colour name such as "red".`);
}

export function colName(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const colIndex = (s: string): number => {
  let c = 0;
  for (const ch of s.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
};

const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`;

function typed(text: string): Scalar {
  if (text === '') return '';
  if (text.startsWith("'")) return text.slice(1);
  if (text === 'TRUE') return true;
  if (text === 'FALSE') return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return Number(text);
  return text;
}

function plain(s: string): string {
  return s.startsWith("'") ? s.slice(1) : s;
}

function rawOf(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /^[=+\-@]/.test(s) && !/^[+-]?\d/.test(s) && !s.startsWith('=') ? `'${s}` : s;
}

class Sheet {
  cells = new Map<number, { v: string; f?: string; t: string }>();
  styles = new Map<number, string>();
  formats = new Map<number, string>();
  merges: [number, number, number, number][] = [];
  cols = new Map<number, number>();
  rows = new Map<number, number>();
  visible: 'Visible' | 'Hidden' | 'VeryHidden' = 'Visible';
  tab = '';
  grid = true;
  freeze: [number, number] = [0, 0];
  gone = false;
  constructor(public name: string) {}
}

interface TableModel {
  id: string;
  name: string;
  sheet: string;
  area: [number, number, number, number];
  flags: string;
  style: string;
  cols: string[];
  gone: boolean;
}

interface ChartModel {
  id: string;
  sheet: string;
  name: string;
  type: string;
  title: string;
  xTitle: string;
  yTitle: string;
  legend: string;
  legendOn: boolean;
  titleOn: boolean;
  range: string;
  byRows: boolean;
  anchor: [number, number, number, number];
  gone: boolean;
  fresh: boolean;
}

interface PivotModel {
  name: string;
  sheet: string;
  row: number;
  col: number;
  src: string;
  srcSheet: string;
  rows: string[];
  cols: string[];
  values: { field: string; func: string; name: string }[];
  filters: string[];
  fields: string[];
  gone: boolean;
  fresh: boolean;
}

export class Ctx {
  sheets = new Map<string, Sheet>();
  ops: Op[] = [];
  active = '';
  selection: Snapshot['selection'] = null;
  id = 0;
  title = '';
  tables: TableModel[] = [];
  charts: ChartModel[] = [];
  pivots: PivotModel[] = [];
  names = new Map<string, string>();
  borders = new Map<string, { style: string; weight: string; color: string }>();
  seq = 0;
  flusher: (() => Promise<void>) | null = null;

  load(snap: Snapshot): void {
    this.sheets = new Map();
    for (const s of snap.sheets) {
      const sh = new Sheet(s.name);
      for (const [r, c, v, f, , text] of s.cells as Cell[]) sh.cells.set(r * KEY + c, { v, f, t: text ?? v });
      for (const [r, c, st] of s.styles) sh.styles.set(r * KEY + c, st);
      for (const [r, c, code] of s.formats) sh.formats.set(r * KEY + c, code);
      sh.merges = s.merges.map((m) => [...m] as [number, number, number, number]);
      sh.visible = s.visible;
      sh.tab = s.tab;
      sh.grid = s.grid;
      sh.freeze = [...s.freeze] as [number, number];
      for (const [i, px] of s.cols) sh.cols.set(i, px);
      for (const [i, px] of s.rows) sh.rows.set(i, px);
      this.sheets.set(s.name, sh);
    }
    this.active = snap.active;
    this.selection = snap.selection;
    this.title = snap.title;
    this.tables = snap.tables.map((t, i) => ({ id: String(i + 1), name: t.name, sheet: t.sheet, area: [...t.area] as [number, number, number, number], flags: t.flags, style: t.style, cols: [...t.cols], gone: false }));
    this.charts = snap.charts.map((c) => ({ id: c.id, sheet: c.sheet, name: c.name, type: c.type, title: c.title, xTitle: '', yTitle: '', legend: c.legend, legendOn: c.legend !== 'none', titleOn: true, range: c.range, byRows: false, anchor: [...c.anchor] as [number, number, number, number], gone: false, fresh: false }));
    this.pivots = snap.pivots.map((p) => ({ ...p, gone: false, fresh: false }));
    this.names = new Map(snap.names);
  }

  sheet(name: string): Sheet {
    const s = this.sheets.get(name);
    if (!s || s.gone) throw new Error(`The sheet ${name} does not exist.`);
    return s;
  }

  live(): Sheet[] {
    return [...this.sheets.values()].filter((s) => !s.gone);
  }

  uid(): string {
    return `s${Date.now().toString(36)}${(++this.seq).toString(36)}`;
  }
}

function parseCell(s: string): [number, number] {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.trim());
  if (!m) throw new Error(`${s} is not a cell address`);
  return [Number(m[2]) - 1, colIndex(m[1])];
}

function parseArea(ref: string): [number, number, number, number] {
  const t = ref.trim().replace(/\$/g, '');
  let m = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(t);
  if (m) return [0, Math.min(colIndex(m[1]), colIndex(m[2])), MAX_ROW, Math.max(colIndex(m[1]), colIndex(m[2]))];
  m = /^(\d+):(\d+)$/.exec(t);
  if (m) return [Math.min(Number(m[1]), Number(m[2])) - 1, 0, Math.max(Number(m[1]), Number(m[2])) - 1, MAX_COL];
  const [a, b] = t.split(':');
  const p = parseCell(a);
  const q = b === undefined ? p : parseCell(b);
  return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
}

function splitRef(ctx: Ctx, ref: string, sheet: string): { sheet: string; area: [number, number, number, number] } {
  const named = ctx.names.get(ref.trim());
  if (named) return splitRef(ctx, named.replace(/^=/, ''), sheet);
  const t = ctx.tables.find((x) => !x.gone && x.name.toLowerCase() === ref.trim().toLowerCase());
  if (t) return { sheet: t.sheet, area: t.area };
  const bang = ref.lastIndexOf('!');
  if (bang < 0) return { sheet, area: parseArea(ref) };
  let name = ref.slice(0, bang).trim();
  if (name.startsWith("'") && name.endsWith("'")) name = name.slice(1, -1).replace(/''/g, "'");
  return { sheet: name, area: parseArea(ref.slice(bang + 1)) };
}

export function shiftFormula(f: string, dr: number, dc: number): string {
  return f
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(?<![A-Za-z0-9_.!'])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (_m, ca: string, col: string, ra: string, row: string) => {
            const c = ca ? colIndex(col) : colIndex(col) + dc;
            const r = ra ? Number(row) - 1 : Number(row) - 1 + dr;
            if (c < 0 || r < 0 || c > MAX_COL || r > MAX_ROW) return '#REF!';
            return `${ca}${colName(c)}${ra}${r + 1}`;
          }),
    )
    .join('');
}

const CLEAR_STYLE = 'clear';

export class Range {
  constructor(readonly ctx: Ctx, readonly sheet: string, readonly r0: number, readonly c0: number, readonly r1: number, readonly c1: number) {}

  private data(): Sheet {
    return this.ctx.sheet(this.sheet);
  }

  private size(): number {
    return (this.r1 - this.r0 + 1) * (this.c1 - this.c0 + 1);
  }

  private grid<T>(f: (r: number, c: number) => T): T[][] {
    const used = usedBox(this.data());
    const r1 = this.r1 === MAX_ROW ? Math.max(used[2], this.r0) : this.r1;
    const c1 = this.c1 === MAX_COL ? Math.max(used[3], this.c0) : this.c1;
    if ((r1 - this.r0 + 1) * (c1 - this.c0 + 1) > 5_000_000) throw new Error('The range is too large to read at once. Use a smaller range or getUsedRange().');
    const out: T[][] = [];
    for (let r = this.r0; r <= r1; r++) {
      const row: T[] = [];
      for (let c = this.c0; c <= c1; c++) row.push(f(r, c));
      out.push(row);
    }
    return out;
  }

  private cell(r: number, c: number) {
    return this.data().cells.get(r * KEY + c);
  }

  getAddress(): string {
    return `${this.sheet.includes(' ') || /[^A-Za-z0-9_]/.test(this.sheet) ? `'${this.sheet.replace(/'/g, "''")}'` : this.sheet}!${this.getAddressLocal()}`;
  }

  getAddressLocal(): string {
    if (this.r0 === 0 && this.r1 === MAX_ROW) return `${colName(this.c0)}:${colName(this.c1)}`;
    if (this.c0 === 0 && this.c1 === MAX_COL) return `${this.r0 + 1}:${this.r1 + 1}`;
    return this.r0 === this.r1 && this.c0 === this.c1 ? a1(this.r0, this.c0) : `${a1(this.r0, this.c0)}:${a1(this.r1, this.c1)}`;
  }

  getWorksheet(): Worksheet {
    return new Worksheet(this.ctx, this.sheet);
  }

  getLocalAddress(): string {
    return this.getAddressLocal();
  }

  sort(column: number, descending = false, hasHeader = false): Range {
    this.getSort().apply([{ key: column, ascending: !descending }], false, hasHeader);
    return this;
  }

  getRowCount(): number {
    return this.r1 - this.r0 + 1;
  }

  getColumnCount(): number {
    return this.c1 - this.c0 + 1;
  }

  getRowIndex(): number {
    return this.r0;
  }

  getColumnIndex(): number {
    return this.c0;
  }

  getCellCount(): number {
    return this.size();
  }

  getIsEntireRow(): boolean {
    return this.c0 === 0 && this.c1 === MAX_COL;
  }

  getIsEntireColumn(): boolean {
    return this.r0 === 0 && this.r1 === MAX_ROW;
  }

  getValues(): Scalar[][] {
    return this.grid((r, c) => typed(this.cell(r, c)?.v ?? ''));
  }

  getValue(): Scalar {
    return typed(this.cell(this.r0, this.c0)?.v ?? '');
  }

  getTexts(): string[][] {
    return this.grid((r, c) => this.cell(r, c)?.t ?? '');
  }

  getText(): string {
    return this.cell(this.r0, this.c0)?.t ?? '';
  }

  getFormulas(): string[][] {
    return this.grid((r, c) => {
      const x = this.cell(r, c);
      return x?.f ?? plain(x?.v ?? '');
    });
  }

  getFormula(): string {
    const x = this.cell(this.r0, this.c0);
    return x?.f ?? plain(x?.v ?? '');
  }

  getValueTypes(): string[][] {
    return this.grid((r, c) => typeName(typed(this.cell(r, c)?.v ?? '')));
  }

  getValueType(): string {
    return typeName(this.getValue());
  }

  getNumberFormats(): string[][] {
    return this.grid((r, c) => this.data().formats.get(r * KEY + c) ?? 'General');
  }

  getNumberFormat(): string {
    return this.data().formats.get(this.r0 * KEY + this.c0) ?? 'General';
  }

  private put(rows: unknown[][], formulas: boolean): void {
    if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new Error('Pass a two dimensional array such as [[1, 2], [3, 4]].');
    if (rows.length !== this.getRowCount() || rows.some((r) => r.length !== this.getColumnCount())) throw new Error(`The range ${this.getAddressLocal()} is ${this.getRowCount()} by ${this.getColumnCount()}, but the array is ${rows.length} by ${rows[0]?.length ?? 0}.`);
    rows.forEach((row, i) => row.forEach((v, j) => this.write(this.r0 + i, this.c0 + j, v, formulas)));
  }

  write(r: number, c: number, v: unknown, formulas = false): void {
    if (v === undefined) return;
    const d = this.data();
    const raw = formulas ? (typeof v === 'string' ? v : rawOf(v)) : rawOf(v);
    this.ctx.ops.push({ k: 'edit', sheet: this.sheet, r, c, raw });
    const key = r * KEY + c;
    if (raw.startsWith('=')) d.cells.set(key, { v: '', f: raw, t: '' });
    else if (raw === '') d.cells.delete(key);
    else d.cells.set(key, { v: raw, t: raw });
  }

  setValues(rows: unknown[][]): void {
    this.put(rows, false);
  }

  setValue(v: unknown): void {
    if (this.size() > 2_000_000) throw new Error('The range is too large to fill with one value.');
    this.put(this.grid(() => v), false);
  }

  setFormulas(rows: unknown[][]): void {
    this.put(rows, true);
  }

  setFormula(f: string): void {
    this.put(this.grid(() => f), true);
  }

  setNumberFormats(codes: string[][]): void {
    if (codes.length !== this.getRowCount() || codes.some((r) => r.length !== this.getColumnCount())) throw new Error('The number formats array does not match the range.');
    codes.forEach((row, i) => row.forEach((code, j) => this.fmt(this.r0 + i, this.c0 + j, this.r0 + i, this.c0 + j, code)));
  }

  setNumberFormat(code: string): void {
    this.fmt(this.r0, this.c0, this.r1, this.c1, code);
  }

  private fmt(r0: number, c0: number, r1: number, c1: number, code: string): void {
    this.ctx.ops.push({ k: 'format', sheet: this.sheet, r0, c0, r1, c1, code });
    const d = this.data();
    if (r1 - r0 < 2000 && c1 - c0 < 200) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) d.formats.set(r * KEY + c, code);
  }

  clear(applyTo = 'All'): void {
    const d = this.data();
    const contents = applyTo === 'All' || applyTo === 'Contents';
    const formats = applyTo === 'All' || applyTo === 'Formats';
    if (contents) {
      const [rr, cc] = this.extentIn(d);
      for (let r = this.r0; r <= rr; r++) for (let c = this.c0; c <= cc; c++) if (d.cells.has(r * KEY + c)) this.write(r, c, '');
    }
    if (formats) {
      this.ctx.ops.push({ k: 'style', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, patch: CLEAR_STYLE });
      this.ctx.ops.push({ k: 'format', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, code: 'General' });
      for (const k of [...d.styles.keys()]) if (inside(k, this)) d.styles.delete(k);
      for (const k of [...d.formats.keys()]) if (inside(k, this)) d.formats.delete(k);
    }
    if (applyTo === 'Hyperlinks' || applyTo === 'RemoveHyperlinks' || applyTo === 'All') this.ctx.ops.push({ k: 'unlink', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1 });
  }

  private extentIn(d: Sheet): [number, number] {
    const u = usedBox(d);
    return [Math.min(this.r1, Math.max(u[2], this.r0)), Math.min(this.c1, Math.max(u[3], this.c0))];
  }

  delete(shift: string): void {
    this.shiftCells(shift === 'Up' ? 'up' : 'left');
  }

  insert(shift: string): Range {
    this.shiftCells(shift === 'Down' ? 'down' : 'right');
    return this;
  }

  private shiftCells(dir: 'up' | 'down' | 'left' | 'right'): void {
    const d = this.data();
    const vertical = dir === 'up' || dir === 'down';
    const entire = vertical ? this.getIsEntireRow() : this.getIsEntireColumn();
    const n = vertical ? this.getRowCount() : this.getColumnCount();
    if (entire) {
      this.ctx.ops.push({ k: 'shift', sheet: this.sheet, rows: vertical, at: vertical ? this.r0 : this.c0, n, insert: dir === 'down' || dir === 'right' });
      return;
    }
    const u = usedBox(d);
    const moved: [number, number, { v: string; f?: string; t: string } | undefined][] = [];
    const sign = dir === 'down' || dir === 'right' ? 1 : -1;
    if (vertical) {
      for (let c = this.c0; c <= this.c1; c++) {
        const from = sign > 0 ? this.r0 : this.r1 + 1;
        for (let r = from; r <= Math.max(u[2], this.r1); r++) moved.push([r, c, d.cells.get(r * KEY + c)]);
        if (sign < 0) for (let r = this.r0; r <= this.r1; r++) this.write(r, c, '');
      }
      for (let c = this.c0; c <= this.c1; c++) for (let r = sign > 0 ? this.r0 : this.r1 + 1; r <= Math.max(u[2], this.r1); r++) this.write(r, c, '');
      for (const [r, c, cell] of moved) if (cell) this.write(r + sign * n, c, cell.f ?? cell.v, !!cell.f);
      if (sign > 0) for (let c = this.c0; c <= this.c1; c++) for (let r = this.r0; r <= this.r1; r++) this.write(r, c, '');
    } else {
      for (let r = this.r0; r <= this.r1; r++) {
        for (let c = sign > 0 ? this.c0 : this.c1 + 1; c <= Math.max(u[3], this.c1); c++) moved.push([r, c, d.cells.get(r * KEY + c)]);
        for (let c = sign > 0 ? this.c0 : this.c0; c <= Math.max(u[3], this.c1); c++) this.write(r, c, '');
      }
      for (const [r, c, cell] of moved) if (cell) this.write(r, c + sign * n, cell.f ?? cell.v, !!cell.f);
    }
  }

  autoFill(destination: Range | string, _type = 'FillDefault'): void {
    const dest = typeof destination === 'string' ? rangeOf(this.ctx, destination, this.sheet) : destination;
    this.ctx.ops.push({ k: 'fill', sheet: this.sheet, src: [this.r0, this.c0, this.r1, this.c1], dest: [dest.r0, dest.c0, dest.r1, dest.c1] });
  }

  copyFrom(source: Range | string, copyType = 'All', skipBlanks = false, transpose = false): void {
    const src = typeof source === 'string' ? rangeOf(this.ctx, source, this.sheet) : source;
    const sd = src.data();
    const dr = this.r0 - src.r0;
    const dc = this.c0 - src.c0;
    const h = src.getRowCount();
    const w = src.getColumnCount();
    const vals = copyType === 'All' || copyType === 'Values' || copyType === 'Formulas' || copyType === 'Link';
    const forms = copyType === 'All' || copyType === 'Formulas';
    const sty = copyType === 'All' || copyType === 'Formats';
    const rows = transpose ? w : h;
    const cols = transpose ? h : w;
    const tr = Math.ceil(this.getRowCount() / rows) || 1;
    const tc = Math.ceil(this.getColumnCount() / cols) || 1;
    const reps = (this.getRowCount() > rows || this.getColumnCount() > cols) ? [tr, tc] : [1, 1];
    for (let br = 0; br < reps[0]; br++) {
      for (let bc = 0; bc < reps[1]; bc++) {
        for (let i = 0; i < h; i++) {
          for (let j = 0; j < w; j++) {
            const ti = transpose ? j : i;
            const tj = transpose ? i : j;
            const r = this.r0 + br * rows + ti;
            const c = this.c0 + bc * cols + tj;
            const cell = sd.cells.get((src.r0 + i) * KEY + src.c0 + j);
            if (vals) {
              if (!cell) {
                if (!skipBlanks) this.write(r, c, '');
              } else if (cell.f && forms) this.write(r, c, shiftFormula(cell.f, r - (src.r0 + i), c - (src.c0 + j)), true);
              else this.write(r, c, cell.v);
            }
            if (sty) {
              const st = sd.styles.get((src.r0 + i) * KEY + src.c0 + j);
              this.ctx.ops.push({ k: 'style', sheet: this.sheet, r0: r, c0: c, r1: r, c1: c, patch: st ? `${CLEAR_STYLE};${st}` : CLEAR_STYLE });
              if (st) this.data().styles.set(r * KEY + c, st);
              else this.data().styles.delete(r * KEY + c);
              const code = sd.formats.get((src.r0 + i) * KEY + src.c0 + j) ?? 'General';
              this.ctx.ops.push({ k: 'format', sheet: this.sheet, r0: r, c0: c, r1: r, c1: c, code });
            }
          }
        }
      }
    }
    void dr;
    void dc;
  }

  moveTo(dest: Range | string): void {
    const to = typeof dest === 'string' ? rangeOf(this.ctx, dest, this.sheet) : dest;
    to.copyFrom(this, 'All');
    const keep = new Set<string>();
    for (let r = 0; r < this.getRowCount(); r++) for (let c = 0; c < this.getColumnCount(); c++) keep.add(`${to.sheet}!${to.r0 + r},${to.c0 + c}`);
    for (let r = this.r0; r <= this.r1; r++) for (let c = this.c0; c <= this.c1; c++) if (!keep.has(`${this.sheet}!${r},${c}`)) this.write(r, c, '');
  }

  getFormat(): RangeFormat {
    return new RangeFormat(this);
  }

  getSort(): RangeSort {
    return new RangeSort(this);
  }

  getCell(row: number, column: number): Range {
    return new Range(this.ctx, this.sheet, this.r0 + row, this.c0 + column, this.r0 + row, this.c0 + column);
  }

  getRow(row: number): Range {
    return new Range(this.ctx, this.sheet, this.r0 + row, this.c0, this.r0 + row, this.c1);
  }

  getColumn(column: number): Range {
    return new Range(this.ctx, this.sheet, this.r0, this.c0 + column, this.r1, this.c0 + column);
  }

  getOffsetRange(rowOffset: number, columnOffset: number): Range {
    return new Range(this.ctx, this.sheet, this.r0 + rowOffset, this.c0 + columnOffset, this.r1 + rowOffset, this.c1 + columnOffset);
  }

  getResizedRange(deltaRows: number, deltaColumns: number): Range {
    const r1 = this.r1 + deltaRows;
    const c1 = this.c1 + deltaColumns;
    if (r1 < this.r0 || c1 < this.c0) throw new Error('The resized range would have no cells.');
    return new Range(this.ctx, this.sheet, this.r0, this.c0, r1, c1);
  }

  getRowsAbove(count = 1): Range {
    return new Range(this.ctx, this.sheet, this.r0 - count, this.c0, this.r0 - 1, this.c1);
  }

  getRowsBelow(count = 1): Range {
    return new Range(this.ctx, this.sheet, this.r1 + 1, this.c0, this.r1 + count, this.c1);
  }

  getColumnsBefore(count = 1): Range {
    return new Range(this.ctx, this.sheet, this.r0, this.c0 - count, this.r1, this.c0 - 1);
  }

  getColumnsAfter(count = 1): Range {
    return new Range(this.ctx, this.sheet, this.r0, this.c1 + 1, this.r1, this.c1 + count);
  }

  getLastCell(): Range {
    return this.getCell(this.getRowCount() - 1, this.getColumnCount() - 1);
  }

  getLastRow(): Range {
    return this.getRow(this.getRowCount() - 1);
  }

  getLastColumn(): Range {
    return this.getColumn(this.getColumnCount() - 1);
  }

  getUsedRange(valuesOnly = false): Range {
    const d = this.data();
    let r0 = Infinity;
    let c0 = Infinity;
    let r1 = -1;
    let c1 = -1;
    for (const [k, cell] of d.cells) {
      const r = Math.floor(k / KEY);
      const c = k % KEY;
      if (r < this.r0 || r > this.r1 || c < this.c0 || c > this.c1) continue;
      if (valuesOnly && cell.v === '' && !cell.f) continue;
      r0 = Math.min(r0, r);
      c0 = Math.min(c0, c);
      r1 = Math.max(r1, r);
      c1 = Math.max(c1, c);
    }
    if (r1 < 0) return new Range(this.ctx, this.sheet, this.r0, this.c0, this.r0, this.c0);
    return new Range(this.ctx, this.sheet, r0, c0, r1, c1);
  }

  getEntireColumn(): Range {
    return new Range(this.ctx, this.sheet, 0, this.c0, MAX_ROW, this.c1);
  }

  getEntireRow(): Range {
    return new Range(this.ctx, this.sheet, this.r0, 0, this.r1, MAX_COL);
  }

  getIntersection(other: Range | string): Range | undefined {
    const o = typeof other === 'string' ? rangeOf(this.ctx, other, this.sheet) : other;
    if (o.sheet !== this.sheet) throw new Error('The ranges are on different worksheets.');
    const r0 = Math.max(this.r0, o.r0);
    const c0 = Math.max(this.c0, o.c0);
    const r1 = Math.min(this.r1, o.r1);
    const c1 = Math.min(this.c1, o.c1);
    return r0 > r1 || c0 > c1 ? undefined : new Range(this.ctx, this.sheet, r0, c0, r1, c1);
  }

  getBoundingRect(other: Range | string): Range {
    const o = typeof other === 'string' ? rangeOf(this.ctx, other, this.sheet) : other;
    return new Range(this.ctx, this.sheet, Math.min(this.r0, o.r0), Math.min(this.c0, o.c0), Math.max(this.r1, o.r1), Math.max(this.c1, o.c1));
  }

  find(text: string, criteria: { completeMatch?: boolean; matchCase?: boolean }): Range | undefined {
    const d = this.data();
    const want = criteria.matchCase ? text : text.toLowerCase();
    const hits: [number, number][] = [];
    for (const [k, cell] of d.cells) {
      const r = Math.floor(k / KEY);
      const c = k % KEY;
      if (r < this.r0 || r > this.r1 || c < this.c0 || c > this.c1) continue;
      const have = criteria.matchCase ? cell.t : cell.t.toLowerCase();
      if (criteria.completeMatch ? have === want : have.includes(want)) hits.push([r, c]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return hits[0] ? new Range(this.ctx, this.sheet, hits[0][0], hits[0][1], hits[0][0], hits[0][1]) : undefined;
  }

  replaceAll(text: string, replacement: string, criteria: { completeMatch?: boolean; matchCase?: boolean }): number {
    const d = this.data();
    let n = 0;
    const flags = criteria.matchCase ? 'g' : 'gi';
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(criteria.completeMatch ? `^${esc}$` : esc, flags);
    for (const [k, cell] of [...d.cells]) {
      const r = Math.floor(k / KEY);
      const c = k % KEY;
      if (r < this.r0 || r > this.r1 || c < this.c0 || c > this.c1 || cell.f) continue;
      if (rx.test(plain(cell.v))) {
        rx.lastIndex = 0;
        this.write(r, c, plain(cell.v).replace(rx, () => replacement));
        n++;
      }
      rx.lastIndex = 0;
    }
    return n;
  }

  merge(across = false): void {
    this.ctx.ops.push({ k: 'merge', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, mode: across ? 'across' : 'all' });
  }

  unmerge(): void {
    this.ctx.ops.push({ k: 'merge', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, mode: 'unmerge' });
  }

  removeDuplicates(columns: number[], includesHeader: boolean): { added: number; removed: number; uniqueRemaining: number } {
    const d = this.data();
    const first = this.r0 + (includesHeader ? 1 : 0);
    const seen = new Set<string>();
    const keep: string[][] = [];
    let removed = 0;
    for (let r = first; r <= this.r1; r++) {
      const row: string[] = [];
      for (let c = this.c0; c <= this.c1; c++) row.push(d.cells.get(r * KEY + c)?.f ?? d.cells.get(r * KEY + c)?.v ?? '');
      const key = columns.map((i) => (d.cells.get(r * KEY + this.c0 + i)?.v ?? '').toLowerCase()).join('\u0001');
      if (seen.has(key)) removed++;
      else {
        seen.add(key);
        keep.push(row);
      }
    }
    for (let r = first; r <= this.r1; r++) for (let c = this.c0; c <= this.c1; c++) this.write(r, c, '');
    keep.forEach((row, i) => row.forEach((v, j) => this.write(first + i, this.c0 + j, v, v.startsWith('='))));
    return { added: 0, removed, uniqueRemaining: keep.length };
  }

  getDataValidation(): DataValidation {
    return new DataValidation(this);
  }

  getHyperlink(): { address?: string; documentReference?: string; textToDisplay?: string; screenTip?: string } | undefined {
    return links.get(`${this.sheet}!${this.r0},${this.c0}`);
  }

  setHyperlink(h: { address?: string; documentReference?: string; textToDisplay?: string; screenTip?: string }): void {
    const target = h.address ?? h.documentReference ?? '';
    if (!target) throw new Error('A hyperlink needs an address or a documentReference.');
    for (let r = this.r0; r <= this.r1; r++) {
      for (let c = this.c0; c <= this.c1; c++) {
        links.set(`${this.sheet}!${r},${c}`, h);
        if (h.textToDisplay !== undefined) this.write(r, c, h.textToDisplay);
        this.ctx.ops.push({ k: 'link', sheet: this.sheet, r, c, target: h.documentReference ? `#${h.documentReference}` : target, display: h.textToDisplay ?? '' });
      }
    }
  }

  select(): void {
    this.ctx.selection = { sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1 };
    this.ctx.active = this.sheet;
  }

  getTable(): Table | undefined {
    const t = this.ctx.tables.find((x) => !x.gone && x.sheet === this.sheet && this.r0 >= x.area[0] && this.r0 <= x.area[2] && this.c0 >= x.area[1] && this.c0 <= x.area[3]);
    return t ? new Table(this.ctx, t.id) : undefined;
  }
}

const links = new Map<string, { address?: string; documentReference?: string; textToDisplay?: string; screenTip?: string }>();

function typeName(v: Scalar): string {
  if (v === '') return 'Empty';
  if (typeof v === 'number') return 'Double';
  if (typeof v === 'boolean') return 'Boolean';
  return /^#(N\/A|VALUE!|REF!|DIV\/0!|NUM!|NAME\?|NULL!)/.test(v) ? 'Error' : 'String';
}

function usedBox(d: Sheet): [number, number, number, number] {
  let r1 = 0;
  let c1 = 0;
  for (const k of d.cells.keys()) {
    r1 = Math.max(r1, Math.floor(k / KEY));
    c1 = Math.max(c1, k % KEY);
  }
  return [0, 0, r1, c1];
}

function inside(key: number, r: Range): boolean {
  const row = Math.floor(key / KEY);
  const col = key % KEY;
  return row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
}

export function rangeOf(ctx: Ctx, address: string, sheet: string): Range {
  const { sheet: s, area } = splitRef(ctx, address, sheet);
  ctx.sheet(s);
  return new Range(ctx, s, area[0], area[1], area[2], area[3]);
}

class RangeSort {
  constructor(private readonly r: Range) {}

  apply(fields: { key: number; ascending?: boolean }[], _matchCase?: boolean, hasHeaders = false, orientation = 'Rows'): void {
    if (!fields.length) throw new Error('Pass at least one sort field.');
    if (orientation === 'Columns') throw new Error('Sorting columns left to right is not supported. Sort the rows of the range instead.');
    const r = this.r;
    const keys = fields.map((f): [number, boolean] => [r.c0 + f.key, f.ascending === false]);
    r.ctx.ops.push({ k: 'sort', sheet: r.sheet, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1, keys, header: hasHeaders });
    const d = r.ctx.sheet(r.sheet);
    const first = r.r0 + (hasHeaders ? 1 : 0);
    if (r.r1 - first > 20000) return;
    const rows: ({ v: string; f?: string; t: string } | undefined)[][] = [];
    for (let row = first; row <= r.r1; row++) {
      const line: ({ v: string; f?: string; t: string } | undefined)[] = [];
      for (let col = r.c0; col <= r.c1; col++) line.push(d.cells.get(row * KEY + col));
      rows.push(line);
    }
    const rank = (x: { v: string; t: string } | undefined): [number, number | string] => {
      if (!x || x.v === '') return [4, 0];
      const v = typed(x.v);
      return typeof v === 'number' ? [1, v] : typeof v === 'boolean' ? [3, v ? 1 : 0] : [2, v.toLowerCase()];
    };
    rows.sort((a, b) => {
      for (const [col, desc] of keys) {
        const x = rank(a[col - r.c0]);
        const y = rank(b[col - r.c0]);
        if (x[0] === 4 || y[0] === 4) {
          if (x[0] !== y[0]) return x[0] === 4 ? 1 : -1;
          continue;
        }
        const cmp = x[0] !== y[0] ? x[0] - y[0] : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0;
        if (cmp) return desc ? -cmp : cmp;
      }
      return 0;
    });
    rows.forEach((line, i) => line.forEach((cell, j) => {
      const key = (first + i) * KEY + r.c0 + j;
      if (cell) d.cells.set(key, cell);
      else d.cells.delete(key);
    }));
  }
}

class RangeFormat {
  constructor(private readonly r: Range) {}

  private style(patch: string): void {
    const r = this.r;
    r.ctx.ops.push({ k: 'style', sheet: r.sheet, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1, patch });
    const d = r.ctx.sheet(r.sheet);
    if ((r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1) <= 40_000) for (let row = r.r0; row <= r.r1; row++) for (let col = r.c0; col <= r.c1; col++) d.styles.set(row * KEY + col, mergeStyle(d.styles.get(row * KEY + col) ?? '', patch));
  }

  tokens(): Map<string, string> {
    return tokensOf(this.r.ctx.sheet(this.r.sheet).styles.get(this.r.r0 * KEY + this.r.c0) ?? '');
  }

  apply(patch: string): void {
    this.style(patch);
  }

  getFill(): RangeFill {
    return new RangeFill(this);
  }

  getFont(): RangeFont {
    return new RangeFont(this);
  }

  getRangeBorder(index: string): RangeBorder {
    return new RangeBorder(this.r, this, index);
  }

  getHorizontalAlignment(): string {
    const h = this.tokens().get('ha');
    return h ? h.charAt(0).toUpperCase() + h.slice(1) : 'General';
  }

  setHorizontalAlignment(a: string): void {
    const v = String(a).toLowerCase();
    if (v === 'general') this.style('!ha');
    else if (v === 'left' || v === 'center' || v === 'right') this.style(`ha:${v}`);
    else if (v === 'centeracrossselection') this.style('ha:center');
    else throw new Error(`The alignment ${a} is not supported. Use General, Left, Center or Right.`);
  }

  getVerticalAlignment(): string {
    const v = this.tokens().get('va');
    return v === 'middle' ? 'Center' : v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Bottom';
  }

  setVerticalAlignment(a: string): void {
    const v = String(a).toLowerCase();
    if (v === 'top' || v === 'bottom') this.style(`va:${v}`);
    else if (v === 'center') this.style('va:middle');
    else throw new Error(`The alignment ${a} is not supported. Use Top, Center or Bottom.`);
  }

  getWrapText(): boolean {
    return this.tokens().has('wrap');
  }

  setWrapText(on: boolean): void {
    this.style(on ? 'wrap' : '!wrap');
  }

  getIndentLevel(): number {
    return Number(this.tokens().get('in') ?? 0);
  }

  setIndentLevel(n: number): void {
    this.style(`in:${Math.max(0, Math.min(15, Math.round(n)))}`);
  }

  setTextOrientation(deg: number): void {
    this.style(`rot:${Math.max(-90, Math.min(90, Math.round(deg)))}`);
  }

  getColumnWidth(): number {
    const d = this.r.ctx.sheet(this.r.sheet);
    return d.cols.get(this.r.c0) ?? COL_PX;
  }

  setColumnWidth(px: number): void {
    const r = this.r;
    const d = r.ctx.sheet(r.sheet);
    for (let c = r.c0; c <= Math.min(r.c1, r.c0 + 2000); c++) d.cols.set(c, px);
    r.ctx.ops.push({ k: 'size', sheet: r.sheet, cols: true, i0: r.c0, i1: r.c1, px });
  }

  getRowHeight(): number {
    return this.r.ctx.sheet(this.r.sheet).rows.get(this.r.r0) ?? ROW_PX;
  }

  setRowHeight(px: number): void {
    const r = this.r;
    const d = r.ctx.sheet(r.sheet);
    for (let i = r.r0; i <= Math.min(r.r1, r.r0 + 20000); i++) d.rows.set(i, px);
    r.ctx.ops.push({ k: 'size', sheet: r.sheet, cols: false, i0: r.r0, i1: r.r1, px });
  }

  autofitColumns(): void {
    const r = this.r;
    const d = r.ctx.sheet(r.sheet);
    for (let c = r.c0; c <= Math.min(r.c1, r.c0 + 200); c++) {
      let chars = 3;
      for (const [k, cell] of d.cells) if (k % KEY === c && Math.floor(k / KEY) >= r.r0 && Math.floor(k / KEY) <= r.r1) chars = Math.max(chars, cell.t.split('\n', 1)[0].length);
      const px = Math.min(800, Math.max(40, Math.round(chars * 7.6 + 14)));
      d.cols.set(c, px);
      r.ctx.ops.push({ k: 'size', sheet: r.sheet, cols: true, i0: c, i1: c, px });
    }
  }

  autofitRows(): void {
    const r = this.r;
    const d = r.ctx.sheet(r.sheet);
    for (let i = r.r0; i <= Math.min(r.r1, r.r0 + 2000); i++) {
      d.rows.set(i, ROW_PX);
      r.ctx.ops.push({ k: 'size', sheet: r.sheet, cols: false, i0: i, i1: i, px: ROW_PX });
    }
  }

  getColumnHidden(): boolean {
    return this.r.ctx.sheet(this.r.sheet).cols.get(this.r.c0) === 0;
  }

  setColumnHidden(on: boolean): void {
    this.r.ctx.ops.push({ k: 'hide', sheet: this.r.sheet, rows: false, i0: this.r.c0, i1: this.r.c1, on });
  }

  getRowHidden(): boolean {
    return this.r.ctx.sheet(this.r.sheet).rows.get(this.r.r0) === 0;
  }

  setRowHidden(on: boolean): void {
    this.r.ctx.ops.push({ k: 'hide', sheet: this.r.sheet, rows: true, i0: this.r.r0, i1: this.r.r1, on });
  }
}

function tokensOf(style: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const tok of style.split(';').map((t) => t.trim()).filter(Boolean)) {
    if (tok.startsWith('!')) {
      m.delete(tok.slice(1).split(':')[0]);
      continue;
    }
    if (tok === 'clear') {
      m.clear();
      continue;
    }
    const i = tok.indexOf(':');
    if (i < 0) m.set(tok, '');
    else m.set(tok.slice(0, i), tok.slice(i + 1));
  }
  return m;
}

function mergeStyle(base: string, patch: string): string {
  const m = tokensOf(base);
  for (const tok of patch.split(';').map((t) => t.trim()).filter(Boolean)) {
    if (tok === 'clear') {
      m.clear();
      continue;
    }
    if (tok.startsWith('!')) {
      m.delete(tok.slice(1).split(':')[0]);
      continue;
    }
    const i = tok.indexOf(':');
    if (i < 0) m.set(tok, '');
    else m.set(tok.slice(0, i), tok.slice(i + 1));
  }
  return [...m].map(([k, v]) => (v === '' ? k : `${k}:${v}`)).join(';');
}

class RangeFill {
  constructor(private readonly f: RangeFormat) {}

  getColor(): string {
    const c = this.f.tokens().get('bg');
    return c ? `#${c.toUpperCase()}` : '#FFFFFF';
  }

  setColor(color: string): void {
    this.f.apply(`bg:${hexOf(color)}`);
  }

  clear(): void {
    this.f.apply('!bg');
  }
}

class RangeFont {
  constructor(private readonly f: RangeFormat) {}

  getBold(): boolean {
    return this.f.tokens().has('b');
  }

  setBold(on: boolean): void {
    this.f.apply(on ? 'b' : '!b');
  }

  getItalic(): boolean {
    return this.f.tokens().has('i');
  }

  setItalic(on: boolean): void {
    this.f.apply(on ? 'i' : '!i');
  }

  getUnderline(): string {
    return this.f.tokens().has('u') ? 'Single' : 'None';
  }

  setUnderline(style: string): void {
    this.f.apply(style === 'None' ? '!u' : 'u');
  }

  getStrikethrough(): boolean {
    return this.f.tokens().has('s');
  }

  setStrikethrough(on: boolean): void {
    this.f.apply(on ? 's' : '!s');
  }

  getColor(): string {
    const c = this.f.tokens().get('fc');
    return c ? `#${c.toUpperCase()}` : '#000000';
  }

  setColor(color: string): void {
    this.f.apply(`fc:${hexOf(color)}`);
  }

  getSize(): number {
    return Number(this.f.tokens().get('sz') ?? 11);
  }

  setSize(n: number): void {
    this.f.apply(`sz:${Math.max(1, Math.min(96, Math.round(n)))}`);
  }

  getName(): string {
    return this.f.tokens().get('ff') ?? 'Calibri';
  }

  setName(name: string): void {
    this.f.apply(`ff:${name}`);
  }
}

const LINE: Record<string, string> = { Continuous: 'thin', Dash: 'dashed', DashDot: 'dashed', DashDotDot: 'dashed', Dot: 'dotted', Double: 'double', SlantDashDot: 'dashed' };

class RangeBorder {
  constructor(private readonly r: Range, private readonly f: RangeFormat, private readonly index: string) {}

  private state() {
    const key = `${this.r.sheet}|${this.r.r0},${this.r.c0},${this.r.r1},${this.r.c1}|${this.index}`;
    let s = this.r.ctx.borders.get(key);
    if (!s) {
      s = { style: 'None', weight: 'Thin', color: '000000' };
      this.r.ctx.borders.set(key, s);
    }
    return s;
  }

  getStyle(): string {
    const t = this.f.tokens().get(edgeToken(this.index) ?? '');
    return t ? 'Continuous' : this.state().style;
  }

  getColor(): string {
    return `#${this.state().color.toUpperCase()}`;
  }

  getWeight(): string {
    return this.state().weight;
  }

  setStyle(style: string): void {
    this.state().style = style;
    this.emit();
  }

  setColor(color: string): void {
    this.state().color = hexOf(color);
    this.emit();
  }

  setWeight(weight: string): void {
    this.state().weight = weight;
    this.emit();
  }

  private emit(): void {
    const s = this.state();
    const r = this.r;
    const parts: { token: string; r0: number; c0: number; r1: number; c1: number }[] = [];
    const idx = this.index;
    if (idx === 'EdgeTop') parts.push({ token: 'bt', r0: r.r0, c0: r.c0, r1: r.r0, c1: r.c1 });
    else if (idx === 'EdgeBottom') parts.push({ token: 'bb', r0: r.r1, c0: r.c0, r1: r.r1, c1: r.c1 });
    else if (idx === 'EdgeLeft') parts.push({ token: 'bl', r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c0 });
    else if (idx === 'EdgeRight') parts.push({ token: 'br', r0: r.r0, c0: r.c1, r1: r.r1, c1: r.c1 });
    else if (idx === 'InsideHorizontal') {
      if (r.r1 > r.r0) parts.push({ token: 'bb', r0: r.r0, c0: r.c0, r1: r.r1 - 1, c1: r.c1 });
    } else if (idx === 'InsideVertical') {
      if (r.c1 > r.c0) parts.push({ token: 'br', r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 - 1 });
    } else {
      return;
    }
    const line = s.style === 'None' ? '' : s.style === 'Continuous' ? (s.weight === 'Medium' ? 'medium' : s.weight === 'Thick' ? 'thick' : 'thin') : LINE[s.style] ?? 'thin';
    for (const p of parts) {
      const patch = line ? `${p.token}:${line}:${s.color}` : `!${p.token}`;
      r.ctx.ops.push({ k: 'style', sheet: r.sheet, r0: p.r0, c0: p.c0, r1: p.r1, c1: p.c1, patch });
      const d = r.ctx.sheet(r.sheet);
      if ((p.r1 - p.r0 + 1) * (p.c1 - p.c0 + 1) <= 40_000) for (let row = p.r0; row <= p.r1; row++) for (let col = p.c0; col <= p.c1; col++) d.styles.set(row * KEY + col, mergeStyle(d.styles.get(row * KEY + col) ?? '', patch));
    }
  }
}

function edgeToken(index: string): string | undefined {
  return { EdgeTop: 'bt', EdgeBottom: 'bb', EdgeLeft: 'bl', EdgeRight: 'br' }[index];
}

const RULE_KIND: Record<string, string> = { wholeNumber: 'whole', decimal: 'decimal', list: 'list', date: 'date', textLength: 'length', custom: 'custom' };
const RULE_OP: Record<string, string> = { Between: 'between', NotBetween: 'notbetween', EqualTo: 'eq', NotEqualTo: 'ne', GreaterThan: 'gt', LessThan: 'lt', GreaterThanOrEqualTo: 'ge', LessThanOrEqualTo: 'le' };
const rules = new Map<string, { rule: Record<string, unknown>; alert: { message: string; showAlert: boolean; style: string; title: string }; prompt: { message: string; showPrompt: boolean; title: string }; blanks: boolean }>();

class DataValidation {
  constructor(private readonly r: Range) {}

  private key(): string {
    return `${this.r.sheet}!${this.r.r0},${this.r.c0},${this.r.r1},${this.r.c1}`;
  }

  private state() {
    let s = rules.get(this.key());
    if (!s) {
      s = { rule: {}, alert: { message: '', showAlert: true, style: 'Stop', title: '' }, prompt: { message: '', showPrompt: false, title: '' }, blanks: true };
      rules.set(this.key(), s);
    }
    return s;
  }

  getRule(): Record<string, unknown> {
    return this.state().rule;
  }

  getErrorAlert() {
    return this.state().alert;
  }

  getPrompt() {
    return this.state().prompt;
  }

  getIgnoreBlanks(): boolean {
    return this.state().blanks;
  }

  setRule(rule: Record<string, unknown>): void {
    this.state().rule = rule;
    this.send();
  }

  setErrorAlert(a: { message: string; showAlert: boolean; style: string; title: string }): void {
    this.state().alert = a;
    this.send();
  }

  setPrompt(p: { message: string; showPrompt: boolean; title: string }): void {
    this.state().prompt = p;
    this.send();
  }

  setIgnoreBlanks(on: boolean): void {
    this.state().blanks = on;
    this.send();
  }

  clear(): void {
    rules.delete(this.key());
    this.push('');
  }

  private send(): void {
    const s = this.state();
    const name = Object.keys(s.rule)[0];
    if (!name) return;
    const spec = s.rule[name] as Record<string, unknown>;
    const type = RULE_KIND[name];
    if (!type) throw new Error(`The validation rule ${name} is not supported.`);
    let a = '';
    let b = '';
    let op = '';
    if (name === 'list') {
      const src = String(spec.source ?? '');
      a = src;
    } else if (name === 'custom') {
      const f = String(spec.formula ?? '');
      a = f.startsWith('=') ? f : `=${f}`;
    } else {
      op = RULE_OP[String(spec.operator)] ?? 'between';
      a = String(spec.formula1 ?? '');
      b = spec.formula2 === undefined ? '' : String(spec.formula2);
    }
    const flags = `${s.blanks ? 'b' : ''}${name === 'list' && spec.inCellDropDown !== false ? 'd' : ''}${s.prompt.showPrompt ? 'p' : ''}${s.alert.showAlert ? 'e' : ''}`;
    const style = s.alert.style === 'Warning' ? 'warning' : s.alert.style === 'Information' ? 'info' : 'stop';
    if (name === 'list' && a && !a.startsWith('=') && /^[A-Za-z$']/.test(a) && /!|^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/.test(a)) a = `=${a}`;
    const esc = (x: string) => x.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    this.push([type, op, a, b, flags, style, s.prompt.title, s.prompt.message, s.alert.title, s.alert.message, ''].map(esc).join('\t'));
  }

  private push(line: string): void {
    const r = this.r;
    r.ctx.ops.push({ k: 'validation', sheet: r.sheet, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1, line });
  }
}

export class Worksheet {
  constructor(private readonly ctx: Ctx, private name: string) {}

  private d(): Sheet {
    return this.ctx.sheet(this.name);
  }

  getAutoFilter() {
    const sheet = this.name;
    const store = (this.ctx as unknown as { autoFilters?: Map<string, { area: [number, number, number, number]; cols: Map<number, string[]> }> });
    const filters = (store.autoFilters ??= new Map<string, { area: [number, number, number, number]; cols: Map<number, string[]> }>());
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    const emit = () => {
      const f = filters.get(sheet);
      const text = f ? `area\t${f.area.join(',')}\n${[...f.cols].sort((a, b) => a[0] - b[0]).map(([c, fields]) => `col\t${c}\t${fields.map(esc).join('\t')}\n`).join('')}` : '';
      this.ctx.ops.push({ k: 'filter', sheet, text });
    };
    const area = (range: Range | string): [number, number, number, number] => {
      const r = typeof range === 'string' ? this.getRange(range) : range;
      return [r.r0, r.c0, r.r1, r.c1];
    };
    return {
      apply: (range: Range | string, columnIndex?: number, criteria?: { filterOn?: string; values?: string[]; blanks?: boolean; fields?: string[] }) => {
        const a = area(range);
        const cur = filters.get(sheet);
        const f = cur && cur.area.every((x, i) => x === a[i]) ? cur : { area: a, cols: new Map<number, string[]>() };
        filters.set(sheet, f);
        if (columnIndex !== undefined && criteria) {
          if (criteria.filterOn === 'Values') f.cols.set(columnIndex, ['values', criteria.blanks === false ? '0' : '1', ...(criteria.values ?? []).map(String)]);
          else if (criteria.fields) f.cols.set(columnIndex, criteria.fields.map(String));
        }
        emit();
      },
      clearCriteria: () => {
        filters.get(sheet)?.cols.clear();
        emit();
      },
      remove: () => {
        filters.delete(sheet);
        emit();
      },
    };
  }

  getName(): string {
    this.d();
    return this.name;
  }

  setName(name: string): void {
    const n = String(name).slice(0, 31);
    if (!n || /[\\/?*[\]:]/.test(n)) throw new Error('A sheet name cannot be empty or contain \\ / ? * [ ] :');
    if (this.ctx.sheets.has(n) && !this.ctx.sheets.get(n)!.gone && n !== this.name) throw new Error(`A sheet named ${n} already exists.`);
    const s = this.d();
    this.ctx.ops.push({ k: 'sheetOp', sheet: this.name, op: 'rename', name: n });
    this.ctx.sheets.delete(this.name);
    s.name = n;
    this.ctx.sheets.set(n, s);
    for (const t of this.ctx.tables) if (t.sheet === this.name) t.sheet = n;
    for (const c of this.ctx.charts) if (c.sheet === this.name) c.sheet = n;
    for (const p of this.ctx.pivots) {
      if (p.sheet === this.name) p.sheet = n;
      if (p.srcSheet === this.name) p.srcSheet = n;
    }
    if (this.ctx.active === this.name) this.ctx.active = n;
    this.name = n;
  }

  getPosition(): number {
    return this.ctx.live().findIndex((s) => s.name === this.name);
  }

  setPosition(position: number): void {
    const live = this.ctx.live();
    const at = Math.max(0, Math.min(position, live.length - 1));
    this.ctx.ops.push({ k: 'sheetOp', sheet: this.name, op: 'move', to: at });
    const order = live.filter((s) => s.name !== this.name);
    order.splice(at, 0, this.d());
    const map = new Map<string, Sheet>();
    for (const s of order) map.set(s.name, s);
    for (const [k, s] of this.ctx.sheets) if (s.gone) map.set(k, s);
    this.ctx.sheets = map;
  }

  getVisibility(): string {
    return this.d().visible;
  }

  setVisibility(v: string): void {
    this.d().visible = v as 'Visible' | 'Hidden' | 'VeryHidden';
    this.ctx.ops.push({ k: 'sheetOp', sheet: this.name, op: 'visible', value: v });
  }

  getTabColor(): string {
    return this.d().tab ? `#${this.d().tab.toUpperCase()}` : '';
  }

  setTabColor(color: string): void {
    const hex = color === '' ? '' : hexOf(color);
    this.d().tab = hex;
    this.ctx.ops.push({ k: 'sheetOp', sheet: this.name, op: 'tab', value: hex });
  }

  getShowGridlines(): boolean {
    return this.d().grid;
  }

  setShowGridlines(on: boolean): void {
    this.d().grid = on;
    this.ctx.ops.push({ k: 'sheetOp', sheet: this.name, op: 'grid', on });
  }

  getFreezePanes(): FreezePanes {
    return new FreezePanes(this.ctx, this.name);
  }

  getRange(address?: string): Range {
    if (address === undefined) return this.getUsedRange();
    const { sheet, area } = splitRef(this.ctx, address, this.name);
    this.ctx.sheet(sheet);
    return new Range(this.ctx, sheet, area[0], area[1], area[2], area[3]);
  }

  getCell(row: number, column: number): Range {
    this.d();
    return new Range(this.ctx, this.name, row, column, row, column);
  }

  getRangeByIndexes(row: number, col: number, rows: number, cols: number): Range {
    this.d();
    return new Range(this.ctx, this.name, row, col, row + rows - 1, col + cols - 1);
  }

  getUsedRange(valuesOnly = false): Range {
    return new Range(this.ctx, this.name, 0, 0, MAX_ROW, MAX_COL).getUsedRange(valuesOnly);
  }

  getTables(): Table[] {
    return this.ctx.tables.filter((t) => !t.gone && t.sheet === this.name).map((t) => new Table(this.ctx, t.id));
  }

  getTable(key: string): Table | undefined {
    return this.getTables().find((t) => t.getName() === key || t.getId() === key);
  }

  addTable(address: Range | string, hasHeaders: boolean): Table {
    const r = typeof address === 'string' ? rangeOf(this.ctx, address, this.name) : address;
    return addTable(this.ctx, r, hasHeaders);
  }

  getCharts(): Chart[] {
    return this.ctx.charts.filter((c) => !c.gone && c.sheet === this.name).map((c) => new Chart(this.ctx, c.id));
  }

  getChart(name: string): Chart | undefined {
    return this.getCharts().find((c) => c.getName() === name || c.getId() === name);
  }

  addChart(type: string, source: Range, seriesBy = 'Auto'): Chart {
    this.d();
    const id = this.ctx.uid();
    const rows = source.getRowCount();
    const cols = source.getColumnCount();
    const byRows = seriesBy === 'Rows' || (seriesBy === 'Auto' && rows < cols);
    const model: ChartModel = {
      id,
      sheet: this.name,
      name: `Chart ${this.ctx.charts.filter((c) => !c.gone).length + 1}`,
      type,
      title: '',
      xTitle: '',
      yTitle: '',
      legend: 'right',
      legendOn: true,
      titleOn: true,
      range: source.getAddress(),
      byRows,
      anchor: [source.r0, source.c1 + 2, source.r0 + 14, source.c1 + 9],
      gone: false,
      fresh: true,
    };
    this.ctx.charts.push(model);
    this.ctx.ops.push({ k: 'chart', action: 'add', id, sheet: this.name, patch: chartPatch(model) });
    return new Chart(this.ctx, id);
  }

  getPivotTables(): PivotTable[] {
    return this.ctx.pivots.filter((p) => !p.gone && p.sheet === this.name).map((p) => new PivotTable(this.ctx, p.name));
  }

  getPivotTable(name: string): PivotTable | undefined {
    return this.getPivotTables().find((p) => p.getName() === name);
  }

  addPivotTable(name: string, source: Range | string | Table, destination: Range | string): PivotTable {
    return addPivot(this.ctx, name, source, destination, this.name);
  }

  activate(): void {
    this.d();
    this.ctx.active = this.name;
    this.ctx.ops.push({ k: 'sheetOp', sheet: this.name, op: 'show' });
  }

  delete(): void {
    if (this.ctx.live().length < 2) throw new Error('A workbook needs at least one visible worksheet.');
    this.d().gone = true;
    this.ctx.ops.push({ k: 'sheetOp', sheet: this.name, op: 'delete' });
    for (const t of this.ctx.tables) if (t.sheet === this.name) t.gone = true;
    for (const c of this.ctx.charts) if (c.sheet === this.name) c.gone = true;
    if (this.ctx.active === this.name) this.ctx.active = this.ctx.live()[0].name;
  }

  getNamedItems(): NamedItem[] {
    return [...this.ctx.names.keys()].filter((n) => (this.ctx.names.get(n) ?? '').startsWith(`${this.name}!`) || (this.ctx.names.get(n) ?? '').startsWith(`'${this.name}'!`)).map((n) => new NamedItem(this.ctx, n));
  }

  addNamedItem(name: string, reference: Range | string, comment?: string): NamedItem {
    return addName(this.ctx, name, reference, this.name, comment);
  }

  getWorkbook(): Workbook {
    return new Workbook(this.ctx);
  }
}

class FreezePanes {
  constructor(private readonly ctx: Ctx, private readonly sheet: string) {}

  freezeRows(count: number): void {
    this.at(count, 0);
  }

  freezeColumns(count = 1): void {
    this.at(0, count);
  }

  freezeAt(frozen: Range | string): void {
    const r = typeof frozen === 'string' ? rangeOf(this.ctx, frozen, this.sheet) : frozen;
    this.at(r.r1 + 1, r.c1 + 1);
  }

  unfreeze(): void {
    this.at(0, 0);
  }

  getLocationOrNullObject(): Range | undefined {
    const [r, c] = this.ctx.sheet(this.sheet).freeze;
    return r || c ? new Range(this.ctx, this.sheet, 0, 0, Math.max(r, 1) - 1, Math.max(c, 1) - 1) : undefined;
  }

  private at(rows: number, cols: number): void {
    this.ctx.sheet(this.sheet).freeze = [rows, cols];
    this.ctx.ops.push({ k: 'sheetOp', sheet: this.sheet, op: 'freeze', rows, cols });
  }
}

class NamedItem {
  constructor(private readonly ctx: Ctx, private readonly name: string) {}

  getName(): string {
    return this.name;
  }

  getFormula(): string {
    const f = this.ctx.names.get(this.name) ?? '';
    return f.startsWith('=') ? f : `=${f}`;
  }

  getRange(): Range | undefined {
    try {
      return rangeOf(this.ctx, (this.ctx.names.get(this.name) ?? '').replace(/^=/, ''), this.ctx.active);
    } catch {
      return undefined;
    }
  }

  delete(): void {
    this.ctx.names.delete(this.name);
    this.ctx.ops.push({ k: 'name', name: this.name, refers: '' });
  }
}

function addName(ctx: Ctx, name: string, reference: Range | string, sheet: string, _comment?: string): NamedItem {
  if (!/^[A-Za-z_\\][\w.]*$/.test(name)) throw new Error(`${name} is not a valid name.`);
  const refers = typeof reference === 'string' ? (reference.startsWith('=') ? reference : reference.includes('!') ? `=${reference}` : `=${rangeOf(ctx, reference, sheet).getAddress()}`) : `=${reference.getAddress()}`;
  ctx.names.set(name, refers);
  ctx.ops.push({ k: 'name', name, refers });
  return new NamedItem(ctx, name);
}

function addTable(ctx: Ctx, r: Range, hasHeaders: boolean): Table {
  if (ctx.tables.some((t) => !t.gone && t.sheet === r.sheet && t.area[0] <= r.r1 && t.area[2] >= r.r0 && t.area[1] <= r.c1 && t.area[3] >= r.c0)) throw new Error('A table cannot overlap another table.');
  if (!hasHeaders) throw new Error('Put column headings in the first row of the range and pass true. FormCel tables need a header row.');
  const d = ctx.sheet(r.sheet);
  const cols: string[] = [];
  for (let c = r.c0; c <= r.c1; c++) cols.push(plain(d.cells.get(r.r0 * KEY + c)?.v ?? '') || `Column${c - r.c0 + 1}`);
  let name = 'Table1';
  for (let i = 1; ctx.tables.some((t) => !t.gone && t.name === name); i++) name = `Table${i + 1}`;
  const model: TableModel = { id: ctx.uid(), name, sheet: r.sheet, area: [r.r0, r.c0, r.r1, r.c1], flags: 'rb', style: 'TableStyleMedium2', cols, gone: false };
  ctx.tables.push(model);
  ctx.ops.push({ k: 'table', action: 'create', name, sheet: r.sheet, area: [...model.area], header: true });
  return new Table(ctx, model.id);
}

export class Table {
  constructor(private readonly ctx: Ctx, private readonly id: string) {}

  private m(): TableModel {
    const t = this.ctx.tables.find((x) => x.id === this.id && !x.gone);
    if (!t) throw new Error('The table no longer exists.');
    return t;
  }

  private range(r0: number, r1: number, c0?: number, c1?: number): Range {
    const t = this.m();
    return new Range(this.ctx, t.sheet, r0, c0 ?? t.area[1], r1, c1 ?? t.area[3]);
  }

  private dataEnd(): number {
    const t = this.m();
    return t.area[2] - (t.flags.includes('t') ? 1 : 0);
  }

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.m().name;
  }

  setName(name: string): void {
    const t = this.m();
    if (!/^[A-Za-z_\\][\w.]*$/.test(name)) throw new Error(`${name} is not a valid table name.`);
    this.ctx.ops.push({ k: 'table', action: 'set', name: t.name, sheet: t.sheet, rename: name });
    t.name = name;
  }

  getWorksheet(): Worksheet {
    return new Worksheet(this.ctx, this.m().sheet);
  }

  getRange(): Range {
    const t = this.m();
    return this.range(t.area[0], t.area[2]);
  }

  getHeaderRowRange(): Range {
    const t = this.m();
    return this.range(t.area[0], t.area[0]);
  }

  getTotalRowRange(): Range {
    const t = this.m();
    if (!t.flags.includes('t')) throw new Error('The table has no totals row.');
    return this.range(t.area[2], t.area[2]);
  }

  getRangeBetweenHeaderAndTotal(): Range {
    const t = this.m();
    return this.range(t.area[0] + 1, this.dataEnd());
  }

  getColumns(): TableColumn[] {
    return this.m().cols.map((_, i) => new TableColumn(this.ctx, this.id, i));
  }

  getColumn(key: string | number): TableColumn | undefined {
    const cols = this.m().cols;
    const i = typeof key === 'number' ? key : cols.findIndex((c) => c === key || String(cols.indexOf(c) + 1) === key);
    return i >= 0 && i < cols.length ? new TableColumn(this.ctx, this.id, i) : undefined;
  }

  getColumnByName(name: string): TableColumn | undefined {
    const i = this.m().cols.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    return i >= 0 ? new TableColumn(this.ctx, this.id, i) : undefined;
  }

  addColumn(index?: number, values?: unknown, name?: string): TableColumn {
    const t = this.m();
    const at = index === undefined || index < 0 || index > t.cols.length ? t.cols.length : index;
    if (at !== t.cols.length) throw new Error('Columns can only be added at the end of a table in FormCel.');
    const c = t.area[3] + 1;
    const body = this.range(t.area[0] + 1, this.dataEnd(), c, c);
    const n = body.getRowCount();
    let data: unknown[] = [];
    let given = name;
    if (Array.isArray(values)) {
      const flat = (values as unknown[]).flat(1);
      if (flat.length === n + 1) {
        given = given ?? String(flat[0]);
        data = flat.slice(1);
      } else data = flat;
    } else if (values !== undefined) data = Array.from({ length: n }, () => values);
    const label = given ?? `Column${t.cols.length + 1}`;
    new Range(this.ctx, t.sheet, t.area[0], c, t.area[0], c).write(t.area[0], c, label);
    for (let i = 0; i < n; i++) if (data[i] !== undefined) body.write(body.r0 + i, c, data[i]);
    t.cols.push(label);
    t.area[3] = c;
    this.ctx.ops.push({ k: 'table', action: 'set', name: t.name, sheet: t.sheet, area: [...t.area] as [number, number, number, number], cols: [...t.cols] });
    return new TableColumn(this.ctx, this.id, t.cols.length - 1);
  }

  getRows(): TableRow[] {
    const t = this.m();
    const n = this.dataEnd() - t.area[0];
    return Array.from({ length: n }, (_, i) => new TableRow(this.ctx, this.id, i));
  }

  getRowCount(): number {
    return this.dataEnd() - this.m().area[0];
  }

  addRow(index?: number, values?: unknown[]): TableRow {
    const t = this.m();
    const count = this.getRowCount();
    const at = index === undefined || index < 0 || index > count ? count : index;
    const row = t.area[0] + 1 + at;
    if (at < count || t.flags.includes('t')) this.ctx.ops.push({ k: 'shift', sheet: t.sheet, rows: true, at: row, n: 1, insert: true });
    else {
      t.area[2] += 1;
      this.ctx.ops.push({ k: 'table', action: 'set', name: t.name, sheet: t.sheet, area: [...t.area] as [number, number, number, number] });
    }
    if (at < count || t.flags.includes('t')) {
      t.area[2] += 1;
      const d = this.ctx.sheet(t.sheet);
      const keys = [...d.cells.keys()].filter((k) => Math.floor(k / KEY) >= row).sort((a, b) => b - a);
      for (const k of keys) {
        const cell = d.cells.get(k)!;
        d.cells.delete(k);
        d.cells.set(k + KEY, cell);
      }
    }
    const flat = ((values ?? []) as unknown[]).flat(1);
    flat.forEach((v, i) => {
      if (i < t.cols.length && v !== undefined) new Range(this.ctx, t.sheet, row, t.area[1] + i, row, t.area[1] + i).write(row, t.area[1] + i, v);
    });
    return new TableRow(this.ctx, this.id, at);
  }

  deleteRowsAt(index: number, count = 1): void {
    const t = this.m();
    const row = t.area[0] + 1 + index;
    this.ctx.ops.push({ k: 'shift', sheet: t.sheet, rows: true, at: row, n: count, insert: false });
    t.area[2] -= count;
    const d = this.ctx.sheet(t.sheet);
    for (const k of [...d.cells.keys()]) {
      const r = Math.floor(k / KEY);
      if (r >= row && r < row + count) d.cells.delete(k);
    }
  }

  getShowTotals(): boolean {
    return this.m().flags.includes('t');
  }

  setShowTotals(on: boolean): void {
    this.flag('t', on);
  }

  getShowHeaders(): boolean {
    return true;
  }

  getShowBandedRows(): boolean {
    return this.m().flags.includes('r');
  }

  setShowBandedRows(on: boolean): void {
    this.flag('r', on);
  }

  getShowBandedColumns(): boolean {
    return this.m().flags.includes('c');
  }

  setShowBandedColumns(on: boolean): void {
    this.flag('c', on);
  }

  getHighlightFirstColumn(): boolean {
    return this.m().flags.includes('f');
  }

  setHighlightFirstColumn(on: boolean): void {
    this.flag('f', on);
  }

  getHighlightLastColumn(): boolean {
    return this.m().flags.includes('l');
  }

  setHighlightLastColumn(on: boolean): void {
    this.flag('l', on);
  }

  getShowFilterButton(): boolean {
    return this.m().flags.includes('b');
  }

  setShowFilterButton(on: boolean): void {
    this.flag('b', on);
  }

  private flag(ch: string, on: boolean): void {
    const t = this.m();
    const has = t.flags.includes(ch);
    if (has === on) return;
    t.flags = on ? t.flags + ch : t.flags.replace(ch, '');
    if (ch === 't') t.area[2] += on ? 1 : -1;
    this.ctx.ops.push({ k: 'table', action: 'set', name: t.name, sheet: t.sheet, flags: t.flags });
  }

  getPredefinedTableStyle(): string {
    return this.m().style;
  }

  setPredefinedTableStyle(style: string): void {
    const t = this.m();
    t.style = style;
    this.ctx.ops.push({ k: 'table', action: 'set', name: t.name, sheet: t.sheet, style });
  }

  getSort(): TableSort {
    return new TableSort(this);
  }

  bodyRange(): Range {
    return this.getRangeBetweenHeaderAndTotal();
  }

  resize(newRange: Range | string): void {
    const t = this.m();
    const r = typeof newRange === 'string' ? rangeOf(this.ctx, newRange, t.sheet) : newRange;
    t.area = [r.r0, r.c0, r.r1, r.c1];
    const d = this.ctx.sheet(t.sheet);
    t.cols = Array.from({ length: r.c1 - r.c0 + 1 }, (_, i) => plain(d.cells.get(r.r0 * KEY + r.c0 + i)?.v ?? '') || `Column${i + 1}`);
    this.ctx.ops.push({ k: 'table', action: 'set', name: t.name, sheet: t.sheet, area: [...t.area] as [number, number, number, number], cols: [...t.cols] });
  }

  convertToRange(): Range {
    const t = this.m();
    const r = new Range(this.ctx, t.sheet, t.area[0], t.area[1], t.area[2], t.area[3]);
    this.ctx.ops.push({ k: 'table', action: 'delete', name: t.name, sheet: t.sheet });
    t.gone = true;
    return r;
  }

  delete(): void {
    const t = this.m();
    const r = new Range(this.ctx, t.sheet, t.area[0], t.area[1], t.area[2], t.area[3]);
    r.clear('Contents');
    this.ctx.ops.push({ k: 'table', action: 'delete', name: t.name, sheet: t.sheet });
    t.gone = true;
  }
}

class TableSort {
  constructor(private readonly t: Table) {}

  apply(fields: { key: number; ascending?: boolean }[], matchCase?: boolean): void {
    this.t.bodyRange().getSort().apply(fields, matchCase, false);
  }
}

class TableColumn {
  constructor(private readonly ctx: Ctx, private readonly tableId: string, private idx: number) {}

  private t(): TableModel {
    const t = this.ctx.tables.find((x) => x.id === this.tableId && !x.gone);
    if (!t) throw new Error('The table no longer exists.');
    return t;
  }

  getId(): number {
    return this.idx + 1;
  }

  getName(): string {
    return this.t().cols[this.idx];
  }

  setName(name: string): void {
    const t = this.t();
    t.cols[this.idx] = name;
    new Range(this.ctx, t.sheet, t.area[0], t.area[1] + this.idx, t.area[0], t.area[1] + this.idx).write(t.area[0], t.area[1] + this.idx, name);
  }

  getIndex(): number {
    return this.idx;
  }

  getRange(): Range {
    const t = this.t();
    return new Range(this.ctx, t.sheet, t.area[0], t.area[1] + this.idx, t.area[2], t.area[1] + this.idx);
  }

  getHeaderRowRange(): Range {
    const t = this.t();
    return new Range(this.ctx, t.sheet, t.area[0], t.area[1] + this.idx, t.area[0], t.area[1] + this.idx);
  }

  getRangeBetweenHeaderAndTotal(): Range {
    const t = this.t();
    return new Range(this.ctx, t.sheet, t.area[0] + 1, t.area[1] + this.idx, t.area[2] - (t.flags.includes('t') ? 1 : 0), t.area[1] + this.idx);
  }

  getTotalRowRange(): Range {
    const t = this.t();
    if (!t.flags.includes('t')) throw new Error('The table has no totals row.');
    return new Range(this.ctx, t.sheet, t.area[2], t.area[1] + this.idx, t.area[2], t.area[1] + this.idx);
  }

  delete(): void {
    const t = this.t();
    if (t.cols.length < 2) throw new Error('A table needs at least one column.');
    this.ctx.ops.push({ k: 'shift', sheet: t.sheet, rows: false, at: t.area[1] + this.idx, n: 1, insert: false });
    t.cols.splice(this.idx, 1);
    t.area[3] -= 1;
  }
}

class TableRow {
  constructor(private readonly ctx: Ctx, private readonly tableId: string, private readonly idx: number) {}

  private t(): TableModel {
    const t = this.ctx.tables.find((x) => x.id === this.tableId && !x.gone);
    if (!t) throw new Error('The table no longer exists.');
    return t;
  }

  getIndex(): number {
    return this.idx;
  }

  getRange(): Range {
    const t = this.t();
    const r = t.area[0] + 1 + this.idx;
    return new Range(this.ctx, t.sheet, r, t.area[1], r, t.area[3]);
  }

  getValues(): Scalar[][] {
    return this.getRange().getValues();
  }

  setValues(values: unknown[]): void {
    const flat = (values as unknown[]).flat(1);
    this.getRange().setValues([flat]);
  }

  delete(): void {
    const t = this.t();
    const row = t.area[0] + 1 + this.idx;
    this.ctx.ops.push({ k: 'shift', sheet: t.sheet, rows: true, at: row, n: 1, insert: false });
    t.area[2] -= 1;
  }
}

const CHART_KIND: Record<string, string> = {
  ColumnClustered: 'column', ColumnStacked: 'column-stacked', ColumnStacked100: 'column-100', BarClustered: 'bar', BarStacked: 'bar-stacked', BarStacked100: 'bar-100', Line: 'line', LineMarkers: 'line', Area: 'area', AreaStacked: 'area-stacked', AreaStacked100: 'area-100',
  Pie: 'pie', Doughnut: 'doughnut', XYScatter: 'scatter', Bubble: 'bubble', Radar: 'radar', Histogram: 'histogram', BoxWhisker: 'box', Waterfall: 'waterfall', Funnel: 'funnel', Treemap: 'treemap', Sunburst: 'sunburst', RegionMap: 'map',
};

function chartPatch(m: ChartModel): ChartPatch {
  const kind = CHART_KIND[m.type];
  if (!kind) throw new Error(`The chart type ${m.type} is not supported.`);
  return { type: kind, title: m.titleOn ? m.title : '', xTitle: m.xTitle, yTitle: m.yTitle, legend: m.legendOn ? m.legend : 'none', range: m.range, byRows: m.byRows, name: m.name, anchor: [...m.anchor] };
}

export class Chart {
  constructor(private readonly ctx: Ctx, private readonly id: string) {}

  private m(): ChartModel {
    const c = this.ctx.charts.find((x) => x.id === this.id && !x.gone);
    if (!c) throw new Error('The chart no longer exists.');
    return c;
  }

  private push(): void {
    const m = this.m();
    this.ctx.ops.push({ k: 'chart', action: 'set', id: m.id, sheet: m.sheet, patch: chartPatch(m) });
  }

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.m().name;
  }

  setName(name: string): void {
    this.m().name = name;
    this.push();
  }

  getChartType(): string {
    return this.m().type;
  }

  setChartType(t: string): void {
    this.m().type = t;
    this.push();
  }

  getTitle(): ChartTitle {
    return new ChartTitle(this.m(), () => this.push());
  }

  getLegend(): ChartLegend {
    return new ChartLegend(this.m(), () => this.push());
  }

  getAxes(): ChartAxes {
    return new ChartAxes(this.m(), () => this.push());
  }

  setData(source: Range, seriesBy = 'Auto'): void {
    const m = this.m();
    m.range = source.getAddress();
    m.byRows = seriesBy === 'Rows' || (seriesBy === 'Auto' && source.getRowCount() < source.getColumnCount());
    this.push();
  }

  setPosition(start: Range | string, end?: Range | string): void {
    const m = this.m();
    const a = typeof start === 'string' ? rangeOf(this.ctx, start, m.sheet) : start;
    const b = end === undefined ? a : typeof end === 'string' ? rangeOf(this.ctx, end, m.sheet) : end;
    m.anchor = [a.r0, a.c0, Math.max(b.r1 + 1, a.r0 + 1), Math.max(b.c1 + 1, a.c0 + 1)];
    this.push();
  }

  getTop(): number {
    return this.m().anchor[0] * ROW_PX;
  }

  setTop(px: number): void {
    const m = this.m();
    const h = m.anchor[2] - m.anchor[0];
    m.anchor[0] = Math.max(0, Math.round(px / ROW_PX));
    m.anchor[2] = m.anchor[0] + h;
    this.push();
  }

  getLeft(): number {
    return this.m().anchor[1] * COL_PX;
  }

  setLeft(px: number): void {
    const m = this.m();
    const w = m.anchor[3] - m.anchor[1];
    m.anchor[1] = Math.max(0, Math.round(px / COL_PX));
    m.anchor[3] = m.anchor[1] + w;
    this.push();
  }

  getWidth(): number {
    const m = this.m();
    return (m.anchor[3] - m.anchor[1]) * COL_PX;
  }

  setWidth(px: number): void {
    const m = this.m();
    m.anchor[3] = m.anchor[1] + Math.max(1, Math.round(px / COL_PX));
    this.push();
  }

  getHeight(): number {
    const m = this.m();
    return (m.anchor[2] - m.anchor[0]) * ROW_PX;
  }

  setHeight(px: number): void {
    const m = this.m();
    m.anchor[2] = m.anchor[0] + Math.max(1, Math.round(px / ROW_PX));
    this.push();
  }

  getWorksheet(): Worksheet {
    return new Worksheet(this.ctx, this.m().sheet);
  }

  delete(): void {
    const m = this.m();
    m.gone = true;
    this.ctx.ops.push({ k: 'chart', action: 'delete', id: m.id, sheet: m.sheet, patch: {} });
  }
}

class ChartTitle {
  constructor(private readonly m: ChartModel, private readonly push: () => void) {}

  getText(): string {
    return this.m.title;
  }

  setText(t: string): void {
    this.m.title = t;
    this.m.titleOn = true;
    this.push();
  }

  getVisible(): boolean {
    return this.m.titleOn;
  }

  setVisible(on: boolean): void {
    this.m.titleOn = on;
    this.push();
  }
}

class ChartLegend {
  constructor(private readonly m: ChartModel, private readonly push: () => void) {}

  getVisible(): boolean {
    return this.m.legendOn;
  }

  setVisible(on: boolean): void {
    this.m.legendOn = on;
    this.push();
  }

  getPosition(): string {
    return this.m.legend.charAt(0).toUpperCase() + this.m.legend.slice(1);
  }

  setPosition(p: string): void {
    const v = String(p).toLowerCase();
    this.m.legend = v === 'top' || v === 'bottom' || v === 'left' || v === 'right' ? v : 'right';
    this.m.legendOn = true;
    this.push();
  }
}

class ChartAxes {
  constructor(private readonly m: ChartModel, private readonly push: () => void) {}

  getCategoryAxis(): ChartAxis {
    return new ChartAxis(this.m, this.push, 'xTitle');
  }

  getValueAxis(): ChartAxis {
    return new ChartAxis(this.m, this.push, 'yTitle');
  }
}

class ChartAxis {
  constructor(private readonly m: ChartModel, private readonly push: () => void, private readonly key: 'xTitle' | 'yTitle') {}

  getTitle(): ChartAxisTitle {
    return new ChartAxisTitle(this.m, this.push, this.key);
  }
}

class ChartAxisTitle {
  constructor(private readonly m: ChartModel, private readonly push: () => void, private readonly key: 'xTitle' | 'yTitle') {}

  getText(): string {
    return this.m[this.key];
  }

  setText(t: string): void {
    this.m[this.key] = t;
    this.push();
  }

  getVisible(): boolean {
    return this.m[this.key] !== '';
  }

  setVisible(on: boolean): void {
    if (!on) this.m[this.key] = '';
    this.push();
  }
}

const FUNC: Record<string, string> = { Automatic: 'sum', Sum: 'sum', Count: 'count', Average: 'average', Max: 'max', Min: 'min', Product: 'product', CountNumbers: 'countnums', StandardDeviation: 'stdev', StandardDeviationP: 'stdevp', Variance: 'var', VarianceP: 'varp' };
const FUNC_BACK = Object.fromEntries(Object.entries(FUNC).filter(([k]) => k !== 'Automatic').map(([k, v]) => [v, k]));
const FUNC_LABEL: Record<string, string> = { sum: 'Sum', count: 'Count', average: 'Average', max: 'Max', min: 'Min', product: 'Product', countnums: 'Count Numbers', stdev: 'StdDev', stdevp: 'StdDevp', var: 'Var', varp: 'Varp' };

function addPivot(ctx: Ctx, name: string, source: Range | string | Table, destination: Range | string, sheet: string): PivotTable {
  if (ctx.pivots.some((p) => !p.gone && p.name.toLowerCase() === name.toLowerCase())) throw new Error(`A PivotTable named ${name} already exists.`);
  const src = source instanceof Table ? source.getRange() : typeof source === 'string' ? rangeOf(ctx, source, sheet) : source;
  const dest = typeof destination === 'string' ? rangeOf(ctx, destination, sheet) : destination;
  const d = ctx.sheet(src.sheet);
  const fields: string[] = [];
  for (let c = src.c0; c <= src.c1; c++) fields.push(plain(d.cells.get(src.r0 * KEY + c)?.v ?? ''));
  if (fields.some((f) => f === '')) throw new Error('Every column of the PivotTable source needs a header.');
  const model: PivotModel = { name, sheet: dest.sheet, row: dest.r0, col: dest.c0, src: src.getAddressLocal(), srcSheet: src.sheet, rows: [], cols: [], values: [], filters: [], fields, gone: false, fresh: true };
  ctx.pivots.push(model);
  ctx.ops.push({ k: 'pivot', action: 'add', name, sheet: dest.sheet, row: dest.r0, col: dest.c0, src: `${src.sheet}!${src.getAddressLocal()}`, patch: {} });
  return new PivotTable(ctx, name);
}

export class PivotTable {
  constructor(private readonly ctx: Ctx, private name: string) {}

  private m(): PivotModel {
    const p = this.ctx.pivots.find((x) => x.name === this.name && !x.gone);
    if (!p) throw new Error('The PivotTable no longer exists.');
    return p;
  }

  private push(): void {
    const m = this.m();
    const patch: PivotPatch = { rows: [...m.rows], cols: [...m.cols], values: m.values.map((v) => ({ ...v })), filters: [...m.filters] };
    this.ctx.ops.push({ k: 'pivot', action: 'set', name: m.name, sheet: m.sheet, patch });
  }

  getName(): string {
    return this.m().name;
  }

  setName(name: string): void {
    const m = this.m();
    m.name = name;
    this.name = name;
  }

  getWorksheet(): Worksheet {
    return new Worksheet(this.ctx, this.m().sheet);
  }

  getLayout(): PivotLayout {
    return new PivotLayout(this.ctx, this.m());
  }

  getHierarchies(): PivotHierarchy[] {
    return this.m().fields.map((f) => new PivotHierarchy(f));
  }

  getHierarchy(name: string): PivotHierarchy {
    const fields = this.m().fields;
    const hit = fields.find((f) => f.toLowerCase() === name.toLowerCase());
    if (!hit) throw new Error(`The PivotTable has no field called ${name}. Its fields are ${fields.join(', ')}.`);
    return new PivotHierarchy(hit);
  }

  getRowHierarchies(): RowColumnPivotHierarchy[] {
    return this.m().rows.map((n) => new RowColumnPivotHierarchy(n));
  }

  getColumnHierarchies(): RowColumnPivotHierarchy[] {
    return this.m().cols.map((n) => new RowColumnPivotHierarchy(n));
  }

  getDataHierarchies(): DataPivotHierarchy[] {
    return this.m().values.map((_, i) => new DataPivotHierarchy(this, i));
  }

  getFilterHierarchies(): RowColumnPivotHierarchy[] {
    return this.m().filters.map((n) => new RowColumnPivotHierarchy(n));
  }

  addRowHierarchy(h: PivotHierarchy): RowColumnPivotHierarchy {
    const m = this.m();
    const n = h.getName();
    if (!m.rows.includes(n)) m.rows.push(n);
    this.push();
    return new RowColumnPivotHierarchy(n);
  }

  addColumnHierarchy(h: PivotHierarchy): RowColumnPivotHierarchy {
    const m = this.m();
    const n = h.getName();
    if (!m.cols.includes(n)) m.cols.push(n);
    this.push();
    return new RowColumnPivotHierarchy(n);
  }

  addDataHierarchy(h: PivotHierarchy): DataPivotHierarchy {
    const m = this.m();
    const n = h.getName();
    m.values.push({ field: n, func: 'sum', name: `Sum of ${n}` });
    this.push();
    return new DataPivotHierarchy(this, m.values.length - 1);
  }

  addFilterHierarchy(h: PivotHierarchy): RowColumnPivotHierarchy {
    const m = this.m();
    const n = h.getName();
    if (!m.filters.includes(n)) m.filters.push(n);
    this.push();
    return new RowColumnPivotHierarchy(n);
  }

  removeRowHierarchy(h: RowColumnPivotHierarchy): void {
    const m = this.m();
    m.rows = m.rows.filter((n) => n !== h.getName());
    this.push();
  }

  removeColumnHierarchy(h: RowColumnPivotHierarchy): void {
    const m = this.m();
    m.cols = m.cols.filter((n) => n !== h.getName());
    this.push();
  }

  removeDataHierarchy(h: DataPivotHierarchy): void {
    const m = this.m();
    m.values = m.values.filter((v) => v.name !== h.getName());
    this.push();
  }

  refresh(): void {
    this.ctx.ops.push({ k: 'pivot', action: 'refresh', name: this.m().name, sheet: this.m().sheet });
  }

  delete(): void {
    const m = this.m();
    m.gone = true;
    this.ctx.ops.push({ k: 'pivot', action: 'delete', name: m.name, sheet: m.sheet });
  }

  update(i: number, patch: { func?: string; name?: string }): void {
    const v = this.m().values[i];
    if (!v) return;
    if (patch.func) {
      const oldLabel = `${FUNC_LABEL[v.func]} of ${v.field}`;
      v.func = patch.func;
      if (v.name === oldLabel) v.name = `${FUNC_LABEL[v.func]} of ${v.field}`;
    }
    if (patch.name !== undefined) v.name = patch.name;
    this.push();
  }

  valueAt(i: number) {
    return this.m().values[i];
  }
}

class PivotLayout {
  constructor(private readonly ctx: Ctx, private readonly m: PivotModel) {}

  getRange(): Range {
    return new Range(this.ctx, this.m.sheet, this.m.row, this.m.col, this.m.row, this.m.col);
  }

  getDataBodyRange(): Range {
    return this.getRange();
  }
}

class PivotHierarchy {
  constructor(private name: string) {}

  getName(): string {
    return this.name;
  }

  setName(n: string): void {
    this.name = n;
  }

  getFields(): { getName(): string }[] {
    return [{ getName: () => this.name }];
  }
}

class RowColumnPivotHierarchy {
  constructor(private readonly name: string) {}

  getName(): string {
    return this.name;
  }
}

class DataPivotHierarchy {
  constructor(private readonly pivot: PivotTable, private readonly i: number) {}

  getName(): string {
    return this.pivot.valueAt(this.i)?.name ?? '';
  }

  setName(n: string): void {
    this.pivot.update(this.i, { name: n });
  }

  getSummarizeBy(): string {
    return FUNC_BACK[this.pivot.valueAt(this.i)?.func ?? 'sum'] ?? 'Sum';
  }

  setSummarizeBy(f: string): void {
    const v = FUNC[f];
    if (!v) throw new Error(`The summary ${f} is not supported.`);
    this.pivot.update(this.i, { func: v });
  }
}

class Application {
  calculate(_t: string): void {
    return;
  }

  getCalculationMode(): string {
    return 'Automatic';
  }
}

export class Workbook {
  constructor(private readonly ctx: Ctx) {}

  getName(): string {
    return this.ctx.title;
  }

  async flush(): Promise<void> {
    await this.ctx.flusher?.();
  }

  getActiveSheet(): Worksheet {
    return this.getActiveWorksheet();
  }

  getSheet(name: string): Worksheet | undefined {
    return this.getWorksheet(name);
  }

  getSheets(): Worksheet[] {
    return this.getWorksheets();
  }

  addSheet(name?: string): Worksheet {
    return this.addWorksheet(name);
  }

  getApplication(): Application {
    return new Application();
  }

  getActiveWorksheet(): Worksheet {
    return new Worksheet(this.ctx, this.ctx.active);
  }

  getWorksheet(name: string): Worksheet | undefined {
    const s = this.ctx.sheets.get(name);
    return s && !s.gone ? new Worksheet(this.ctx, name) : undefined;
  }

  getWorksheets(): Worksheet[] {
    return this.ctx.live().map((s) => new Worksheet(this.ctx, s.name));
  }

  getFirstWorksheet(visibleOnly = false): Worksheet {
    const list = this.ctx.live().filter((s) => !visibleOnly || s.visible === 'Visible');
    return new Worksheet(this.ctx, list[0].name);
  }

  getLastWorksheet(visibleOnly = false): Worksheet {
    const list = this.ctx.live().filter((s) => !visibleOnly || s.visible === 'Visible');
    return new Worksheet(this.ctx, list[list.length - 1].name);
  }

  addWorksheet(name?: string): Worksheet {
    let n = (name ?? `Sheet${this.ctx.live().length + 1}`).slice(0, 31);
    if (!name) for (let i = this.ctx.live().length + 1; this.ctx.sheets.has(n); i++) n = `Sheet${i + 1}`;
    if (this.ctx.sheets.has(n) && !this.ctx.sheets.get(n)!.gone) throw new Error(`A sheet named ${n} already exists.`);
    this.ctx.sheets.set(n, new Sheet(n));
    this.ctx.ops.push({ k: 'sheet', name: n });
    return new Worksheet(this.ctx, n);
  }

  getSelectedRange(): Range {
    const s = this.ctx.selection;
    if (!s) return new Range(this.ctx, this.ctx.active, 0, 0, 0, 0);
    return new Range(this.ctx, s.sheet, s.r0, s.c0, s.r1, s.c1);
  }

  getActiveCell(): Range {
    const r = this.getSelectedRange();
    return new Range(this.ctx, r.sheet, r.r0, r.c0, r.r0, r.c0);
  }

  getTables(): Table[] {
    return this.ctx.tables.filter((t) => !t.gone).map((t) => new Table(this.ctx, t.id));
  }

  getTable(key: string): Table | undefined {
    return this.getTables().find((t) => t.getName() === key || t.getId() === key);
  }

  addTable(address: Range | string, hasHeaders: boolean): Table {
    const r = typeof address === 'string' ? rangeOf(this.ctx, address, this.ctx.active) : address;
    return addTable(this.ctx, r, hasHeaders);
  }

  getPivotTables(): PivotTable[] {
    return this.ctx.pivots.filter((p) => !p.gone).map((p) => new PivotTable(this.ctx, p.name));
  }

  getPivotTable(name: string): PivotTable | undefined {
    return this.getPivotTables().find((p) => p.getName() === name);
  }

  addPivotTable(name: string, source: Range | string | Table, destination: Range | string): PivotTable {
    return addPivot(this.ctx, name, source, destination, this.ctx.active);
  }

  getNamedItems(): NamedItem[] {
    return [...this.ctx.names.keys()].map((n) => new NamedItem(this.ctx, n));
  }

  getNamedItem(name: string): NamedItem | undefined {
    return this.ctx.names.has(name) ? new NamedItem(this.ctx, name) : undefined;
  }

  addNamedItem(name: string, reference: Range | string, comment?: string): NamedItem {
    return addName(this.ctx, name, reference, this.ctx.active, comment);
  }

  refreshAllDataConnections(): void {
    return;
  }

  refreshAllPivotTables(): void {
    for (const p of this.ctx.pivots) if (!p.gone) this.ctx.ops.push({ k: 'pivot', action: 'refresh', name: p.name, sheet: p.sheet });
  }
}

export function buildWorkbook(ctx: Ctx): Workbook {
  return new Workbook(ctx);
}
