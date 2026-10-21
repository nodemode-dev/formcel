import { strip } from './tsStrip';

type Cell = [number, number, string, string | undefined, boolean];
interface SheetSnap {
  name: string;
  cells: Cell[];
}
export interface Snapshot {
  sheets: SheetSnap[];
  active: string;
  selection: { sheet: string; r0: number; c0: number; r1: number; c1: number } | null;
}
export type Op =
  | { k: 'edit'; sheet: string; r: number; c: number; raw: string }
  | { k: 'sheet'; name: string }
  | { k: 'format'; sheet: string; r0: number; c0: number; r1: number; c1: number; code: string }
  | { k: 'style'; sheet: string; r0: number; c0: number; r1: number; c1: number; patch: string }
  | { k: 'sort'; sheet: string; r0: number; c0: number; r1: number; c1: number; keys: [number, boolean][]; header: boolean }
  | { k: 'shift'; sheet: string; rows: boolean; at: number; n: number; insert: boolean }
  | { k: 'cells'; sheet: string; r0: number; c0: number; r1: number; c1: number; dir: string; insert: boolean }
  | { k: 'merge'; sheet: string; r0: number; c0: number; r1: number; c1: number; mode: 'cells' | 'across' | 'unmerge' }
  | { k: 'rename'; name: string; to: string }
  | { k: 'delsheet'; name: string }
  | { k: 'activate'; name: string }
  | { k: 'fill'; sheet: string; src: [number, number, number, number]; dest: [number, number, number, number] }
  | { k: 'filter'; sheet: string; text: string }
  | { k: 'chart'; sheet: string; type: string; range: string; title: string; byRows: boolean };
export type In =
  | { t: 'run'; id: number; code: string; snap: Snapshot; event?: unknown }
  | { t: 'snapshot'; id: number; snap: Snapshot }
  | { t: 'scan'; id: number; code: string }
  | { t: 'call'; id: number; code: string; name: string; args: unknown[] };
export type Out =
  | { t: 'log'; id: number; level: string; text: string }
  | { t: 'flush'; id: number; ops: Op[] }
  | { t: 'done'; id: number; ok: boolean; error?: string; ops: Op[]; result?: unknown }
  | { t: 'scanned'; id: number; names: string[] }
  | { t: 'called'; id: number; ok: boolean; value?: unknown; error?: string };

const send = (self as unknown as Worker).postMessage.bind(self);
const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'WebTransport', 'Worker', 'SharedWorker', 'WebAssembly', 'postMessage', 'addEventListener', 'removeEventListener', 'close', 'XMLHttpRequestUpload', 'Request', 'Response', 'Headers', 'FormData'];

function lockdown(): void {
  let o: object | null = self;
  while (o && o !== Object.prototype) {
    for (const n of BLOCKED) {
      try {
        if (Object.getOwnPropertyDescriptor(o, n)) Object.defineProperty(o, n, { value: undefined, writable: false, configurable: false });
      } catch {
        try {
          delete (o as Record<string, unknown>)[n];
        } catch {
          continue;
        }
      }
    }
    o = Object.getPrototypeOf(o) as object | null;
  }
  for (const n of BLOCKED) {
    try {
      Object.defineProperty(self, n, { value: undefined, writable: false, configurable: false });
    } catch {
      continue;
    }
  }
}

const colName = (col: number): string => {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`;

function parseCell(s: string): [number, number] {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.trim());
  if (!m) throw new Error(`${s} is not a cell address`);
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

function colIndex(s: string): number {
  let col = 0;
  for (const ch of s.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col - 1;
}

const MAX_R = 1048576;
const MAX_C = 16384;

function parseArea(ref: string): [number, number, number, number] {
  const rows = /^\$?(\d{1,7}):\$?(\d{1,7})$/.exec(ref.trim());
  if (rows) return [Math.min(Number(rows[1]), Number(rows[2])) - 1, 0, Math.max(Number(rows[1]), Number(rows[2])) - 1, MAX_C - 1];
  const cols = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(ref.trim());
  if (cols) return [0, Math.min(colIndex(cols[1]), colIndex(cols[2])), MAX_R - 1, Math.max(colIndex(cols[1]), colIndex(cols[2]))];
  const [a, b] = ref.split(':');
  const p = parseCell(a);
  const q = b === undefined ? p : parseCell(b);
  return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
}

type Scalar = string | number | boolean;

function typed(text: string): Scalar {
  if (text === '') return '';
  if (text.startsWith("'")) return text.slice(1);
  if (text === 'TRUE') return true;
  if (text === 'FALSE') return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return Number(text);
  return text;
}

function rawOf(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /^[=+\-@]/.test(s) && !/^[+-]?\d/.test(s) && !s.startsWith('=') ? `'${s}` : s;
}

class Sheet {
  cells = new Map<number, { v: string; f?: string }>();
  constructor(public name: string, cells: Cell[]) {
    for (const [r, c, t, f] of cells) this.cells.set(r * 16384 + c, { v: t, f });
  }

  move(map: (r: number, c: number) => [number, number] | null): void {
    const next = new Map<number, { v: string; f?: string }>();
    for (const [k, x] of this.cells) {
      const to = map(Math.floor(k / 16384), k % 16384);
      if (to) next.set(to[0] * 16384 + to[1], x);
    }
    this.cells = next;
  }
}

const fieldEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

const CHART_TYPES: Record<string, string> = {
  columnclustered: 'column', columnstacked: 'column-stacked', columnstacked100: 'column-100', barclustered: 'bar', barstacked: 'bar-stacked', barstacked100: 'bar-100', line: 'line', area: 'area', areastacked: 'area-stacked', areastacked100: 'area-100', pie: 'pie', doughnut: 'doughnut', xyscatter: 'scatter', bubble: 'bubble', radar: 'radar',
};

class Ctx {
  sheets = new Map<string, Sheet>();
  filters = new Map<string, { area: [number, number, number, number]; cols: Map<number, string[]> }>();
  ops: Op[] = [];
  active = '';
  selection: Snapshot['selection'] = null;
  id = 0;

  load(snap: Snapshot): void {
    this.sheets = new Map(snap.sheets.map((s) => [s.name, new Sheet(s.name, s.cells)]));
    this.active = snap.active;
    this.selection = snap.selection;
  }
}

class Range {
  constructor(private ctx: Ctx, readonly sheet: string, readonly r0: number, readonly c0: number, readonly r1: number, readonly c1: number) {}

  private data(): Sheet {
    const s = this.ctx.sheets.get(this.sheet);
    if (!s) throw new Error(`The sheet ${this.sheet} does not exist.`);
    return s;
  }

  private grid<T>(f: (r: number, c: number) => T): T[][] {
    const out: T[][] = [];
    for (let r = this.r0; r <= this.r1; r++) {
      const row: T[] = [];
      for (let c = this.c0; c <= this.c1; c++) row.push(f(r, c));
      out.push(row);
    }
    return out;
  }

  getAddress(): string {
    return `${this.sheet}!${this.getLocalAddress()}`;
  }

  getLocalAddress(): string {
    return this.r0 === this.r1 && this.c0 === this.c1 ? a1(this.r0, this.c0) : `${a1(this.r0, this.c0)}:${a1(this.r1, this.c1)}`;
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

  getValues(): Scalar[][] {
    const d = this.data();
    return this.grid((r, c) => typed(d.cells.get(r * 16384 + c)?.v ?? ''));
  }

  getTexts(): string[][] {
    const d = this.data();
    return this.grid((r, c) => d.cells.get(r * 16384 + c)?.v ?? '');
  }

  getFormulas(): string[][] {
    const d = this.data();
    return this.grid((r, c) => {
      const x = d.cells.get(r * 16384 + c);
      return x?.f ?? x?.v ?? '';
    });
  }

  getValue(): Scalar {
    return this.getValues()[0][0];
  }

  getFormula(): string {
    return this.getFormulas()[0][0];
  }

  private put(rows: unknown[][], formulas: boolean): void {
    if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new Error('Pass a two dimensional array such as [[1, 2], [3, 4]].');
    if (rows.length !== this.getRowCount() || rows.some((r) => r.length !== this.getColumnCount())) throw new Error(`The range ${this.getLocalAddress()} is ${this.getRowCount()} by ${this.getColumnCount()}, but the array is ${rows.length} by ${rows[0]?.length ?? 0}.`);
    const d = this.data();
    rows.forEach((row, i) =>
      row.forEach((v, j) => {
        const r = this.r0 + i;
        const c = this.c0 + j;
        const raw = formulas ? (typeof v === 'string' ? v : rawOf(v)) : rawOf(v);
        this.ctx.ops.push({ k: 'edit', sheet: this.sheet, r, c, raw });
        if (raw.startsWith('=')) d.cells.set(r * 16384 + c, { v: '', f: raw });
        else if (raw === '') d.cells.delete(r * 16384 + c);
        else d.cells.set(r * 16384 + c, { v: raw });
      }),
    );
  }

  setValues(rows: unknown[][]): Range {
    this.put(rows, false);
    return this;
  }

  setFormulas(rows: unknown[][]): Range {
    this.put(rows, true);
    return this;
  }

  setValue(v: unknown): Range {
    this.put(this.grid(() => v), false);
    return this;
  }

  setFormula(f: string): Range {
    this.put(this.grid(() => f), true);
    return this;
  }

  clear(applyTo = 'All'): Range {
    const what = String(applyTo).toLowerCase();
    if (what === 'all' || what === 'contents') {
      const d = this.data();
      for (const k of [...d.cells.keys()]) {
        const r = Math.floor(k / 16384);
        const c = k % 16384;
        if (r < this.r0 || r > this.r1 || c < this.c0 || c > this.c1) continue;
        this.ctx.ops.push({ k: 'edit', sheet: this.sheet, r, c, raw: '' });
        d.cells.delete(k);
      }
    }
    if (what === 'all' || what === 'formats') {
      this.style('clear');
      this.setNumberFormat('');
    }
    return this;
  }

  private wholeRows(): boolean {
    return this.c0 === 0 && this.c1 === MAX_C - 1;
  }

  private wholeCols(): boolean {
    return this.r0 === 0 && this.r1 === MAX_R - 1;
  }

  insert(shift = 'Down'): Range {
    const dir = String(shift).toLowerCase() === 'right' ? 'right' : 'down';
    const d = this.data();
    if (this.wholeRows()) {
      const n = this.r1 - this.r0 + 1;
      this.ctx.ops.push({ k: 'shift', sheet: this.sheet, rows: true, at: this.r0, n, insert: true });
      d.move((r, c) => [r >= this.r0 ? r + n : r, c]);
    } else if (this.wholeCols()) {
      const n = this.c1 - this.c0 + 1;
      this.ctx.ops.push({ k: 'shift', sheet: this.sheet, rows: false, at: this.c0, n, insert: true });
      d.move((r, c) => [r, c >= this.c0 ? c + n : c]);
    } else {
      this.ctx.ops.push({ k: 'cells', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, dir, insert: true });
      const h = this.getRowCount();
      const w = this.getColumnCount();
      if (dir === 'down') d.move((r, c) => [c >= this.c0 && c <= this.c1 && r >= this.r0 ? r + h : r, c]);
      else d.move((r, c) => [r, r >= this.r0 && r <= this.r1 && c >= this.c0 ? c + w : c]);
    }
    return this;
  }

  delete(shift = 'Up'): Range {
    const dir = String(shift).toLowerCase() === 'left' ? 'left' : 'up';
    const d = this.data();
    if (this.wholeRows()) {
      const n = this.r1 - this.r0 + 1;
      this.ctx.ops.push({ k: 'shift', sheet: this.sheet, rows: true, at: this.r0, n, insert: false });
      d.move((r, c) => (r > this.r1 ? [r - n, c] : r >= this.r0 ? null : [r, c]));
    } else if (this.wholeCols()) {
      const n = this.c1 - this.c0 + 1;
      this.ctx.ops.push({ k: 'shift', sheet: this.sheet, rows: false, at: this.c0, n, insert: false });
      d.move((r, c) => (c > this.c1 ? [r, c - n] : c >= this.c0 ? null : [r, c]));
    } else {
      this.ctx.ops.push({ k: 'cells', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, dir, insert: false });
      const h = this.getRowCount();
      const w = this.getColumnCount();
      const inCols = (c: number) => c >= this.c0 && c <= this.c1;
      const inRows = (r: number) => r >= this.r0 && r <= this.r1;
      if (dir === 'up') d.move((r, c) => (!inCols(c) ? [r, c] : r > this.r1 ? [r - h, c] : r >= this.r0 ? null : [r, c]));
      else d.move((r, c) => (!inRows(r) ? [r, c] : c > this.c1 ? [r, c - w] : c >= this.c0 ? null : [r, c]));
    }
    return this;
  }

  merge(across = false): Range {
    this.ctx.ops.push({ k: 'merge', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, mode: across ? 'across' : 'cells' });
    return this;
  }

  unmerge(): Range {
    this.ctx.ops.push({ k: 'merge', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, mode: 'unmerge' });
    return this;
  }

  autoFill(destination: Range | string, _type = 'FillDefault'): Range {
    const dest = typeof destination === 'string' ? new Worksheet(this.ctx, this.sheet).getRange(destination) : destination;
    this.ctx.ops.push({ k: 'fill', sheet: this.sheet, src: [this.r0, this.c0, this.r1, this.c1], dest: [dest.r0, dest.c0, dest.r1, dest.c1] });
    return this;
  }

  setNumberFormat(code: string): Range {
    this.ctx.ops.push({ k: 'format', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, code });
    return this;
  }

  sort(column: number, descending = false, hasHeader = false): Range {
    this.ctx.ops.push({ k: 'sort', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, keys: [[this.c0 + column, descending]], header: hasHeader });
    return this;
  }

  private style(patch: string): void {
    this.ctx.ops.push({ k: 'style', sheet: this.sheet, r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, patch });
  }

  getFormat() {
    const hex = (c: string) => c.replace('#', '').toLowerCase();
    return {
      getFill: () => ({ setColor: (c: string) => this.style(`bg:${hex(c)}`), clear: () => this.style('!bg') }),
      getFont: () => ({
        setBold: (on = true) => this.style(on ? 'b' : '!b'),
        setItalic: (on = true) => this.style(on ? 'i' : '!i'),
        setUnderline: (on = true) => this.style(on ? 'u' : '!u'),
        setColor: (c: string) => this.style(`fc:${hex(c)}`),
        setSize: (n: number) => this.style(`sz:${n}`),
        setName: (n: string) => this.style(`ff:${n}`),
      }),
      setHorizontalAlignment: (a: string) => this.style(`ha:${a.toLowerCase()}`),
      setWrapText: (on = true) => this.style(on ? 'wrap' : '!wrap'),
    };
  }
}

class Worksheet {
  constructor(private ctx: Ctx, private name: string) {}

  getName(): string {
    return this.name;
  }

  getRange(addr?: string): Range {
    if (addr === undefined) return this.getUsedRange();
    const ref = addr.includes('!') ? addr.slice(addr.lastIndexOf('!') + 1) : addr;
    const [r0, c0, r1, c1] = parseArea(ref);
    return new Range(this.ctx, this.name, r0, c0, r1, c1);
  }

  getCell(row: number, col: number): Range {
    return new Range(this.ctx, this.name, row, col, row, col);
  }

  getRangeByIndexes(row: number, col: number, rows: number, cols: number): Range {
    return new Range(this.ctx, this.name, row, col, row + rows - 1, col + cols - 1);
  }

  getUsedRange(): Range {
    const s = this.ctx.sheets.get(this.name);
    let r1 = 0;
    let c1 = 0;
    for (const k of s?.cells.keys() ?? []) {
      r1 = Math.max(r1, Math.floor(k / 16384));
      c1 = Math.max(c1, k % 16384);
    }
    return new Range(this.ctx, this.name, 0, 0, r1, c1);
  }

  setName(to: string): Worksheet {
    const s = this.ctx.sheets.get(this.name);
    if (!s) throw new Error(`The sheet ${this.name} does not exist.`);
    if (to !== this.name && this.ctx.sheets.has(to)) throw new Error(`A sheet named ${to} already exists.`);
    const next = new Map<string, Sheet>();
    for (const [k, v] of this.ctx.sheets) next.set(k === this.name ? to : k, v);
    s.name = to;
    this.ctx.sheets = next;
    if (this.ctx.active === this.name) this.ctx.active = to;
    this.ctx.ops.push({ k: 'rename', name: this.name, to });
    this.name = to;
    return this;
  }

  delete(): void {
    if (this.ctx.sheets.size < 2) throw new Error('A workbook needs at least one sheet.');
    this.ctx.sheets.delete(this.name);
    this.ctx.ops.push({ k: 'delsheet', name: this.name });
    if (this.ctx.active === this.name) this.ctx.active = this.ctx.sheets.keys().next().value ?? '';
  }

  activate(): Worksheet {
    this.ctx.active = this.name;
    this.ctx.ops.push({ k: 'activate', name: this.name });
    return this;
  }

  getAutoFilter() {
    const key = this.name;
    const emit = () => {
      const f = this.ctx.filters.get(key);
      const text = f ? `area\t${f.area.join(',')}\n${[...f.cols].sort((a, b) => a[0] - b[0]).map(([c, fields]) => `col\t${c}\t${fields.map(fieldEsc).join('\t')}\n`).join('')}` : '';
      this.ctx.ops.push({ k: 'filter', sheet: key, text });
    };
    const area = (range: Range | string): [number, number, number, number] => {
      const r = typeof range === 'string' ? this.getRange(range) : range;
      return [r.r0, r.c0, r.r1, r.c1];
    };
    return {
      apply: (range: Range | string, columnIndex?: number, criteria?: { filterOn?: string; values?: string[]; blanks?: boolean; fields?: string[] }) => {
        const a = area(range);
        const cur = this.ctx.filters.get(key);
        const same = cur && cur.area.every((x, i) => x === a[i]);
        const f = same ? cur : { area: a, cols: new Map<number, string[]>() };
        this.ctx.filters.set(key, f);
        if (columnIndex !== undefined && criteria) {
          if (criteria.filterOn === 'Values') f.cols.set(columnIndex, ['values', criteria.blanks === false ? '0' : '1', ...(criteria.values ?? []).map(String)]);
          else if (criteria.fields) f.cols.set(columnIndex, criteria.fields.map(String));
        }
        emit();
      },
      clearCriteria: () => {
        const f = this.ctx.filters.get(key);
        if (f) f.cols.clear();
        emit();
      },
      remove: () => {
        this.ctx.filters.delete(key);
        emit();
      },
    };
  }

  addChart(type: string, source: Range | string, seriesBy = 'Auto') {
    const range = typeof source === 'string' ? source.replace(/^.*!/, '') : source.getLocalAddress();
    const op = { k: 'chart' as const, sheet: this.name, type: CHART_TYPES[String(type).toLowerCase()] ?? String(type).toLowerCase(), range, title: '', byRows: String(seriesBy).toLowerCase() === 'rows' };
    this.ctx.ops.push(op);
    const chart = {
      setTitle: (text: string) => {
        op.title = text;
        return chart;
      },
      getTitle: () => ({
        setText: (text: string) => {
          op.title = text;
        },
      }),
    };
    return chart;
  }
}

class Workbook {
  constructor(private ctx: Ctx, private title: string) {}

  getName(): string {
    return this.title;
  }

  getActiveWorksheet(): Worksheet {
    return new Worksheet(this.ctx, this.ctx.active);
  }

  getActiveSheet(): Worksheet {
    return this.getActiveWorksheet();
  }

  getWorksheet(name: string): Worksheet | undefined {
    return this.ctx.sheets.has(name) ? new Worksheet(this.ctx, name) : undefined;
  }

  getSheet(name: string): Worksheet | undefined {
    return this.getWorksheet(name);
  }

  getWorksheets(): Worksheet[] {
    return [...this.ctx.sheets.keys()].map((n) => new Worksheet(this.ctx, n));
  }

  getSheets(): Worksheet[] {
    return this.getWorksheets();
  }

  addWorksheet(name?: string): Worksheet {
    let n = name ?? `Sheet${this.ctx.sheets.size + 1}`;
    if (this.ctx.sheets.has(n)) throw new Error(`A sheet named ${n} already exists.`);
    n = n.slice(0, 31);
    this.ctx.sheets.set(n, new Sheet(n, []));
    this.ctx.ops.push({ k: 'sheet', name: n });
    return new Worksheet(this.ctx, n);
  }

  addSheet(name?: string): Worksheet {
    return this.addWorksheet(name);
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

  async flush(): Promise<void> {
    const ctx = this.ctx;
    const ops = ctx.ops.splice(0);
    await new Promise<void>((resolve) => {
      waiting.set(ctx.id, (snap) => {
        ctx.load(snap);
        resolve();
      });
      send({ t: 'flush', id: ctx.id, ops } satisfies Out);
    });
  }
}

const waiting = new Map<number, (s: Snapshot) => void>();
const fnCache = new Map<string, Record<string, (...a: unknown[]) => unknown>>();

function show(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function consoleFor(id: number) {
  const mk = (level: string) => (...a: unknown[]) => send({ t: 'log', id, level, text: a.map(show).join(' ') } satisfies Out);
  return { log: mk('log'), info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('log') };
}

const FORBIDDEN = /\bimport\s*\(|\bimportScripts\b|\bimport\s+[\w{*]/;

function compile(code: string): string {
  if (FORBIDDEN.test(code)) throw new Error('Scripts cannot import code or reach the network.');
  return strip(code);
}

function scan(code: string): string[] {
  const names: string[] = [];
  const re = /@customfunction[\s\S]*?\bfunction\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) names.push(m[1]);
  return names;
}

function table(code: string, con: ReturnType<typeof consoleFor>, wb?: Workbook, event?: unknown): { main?: (w: unknown, e?: unknown) => unknown; fns: Record<string, (...a: unknown[]) => unknown> } {
  const names = scan(code);
  const js = compile(code);
  const body = `${js}\n;return { main: typeof main === 'function' ? main : undefined, fns: { ${names.map((n) => `${JSON.stringify(n)}: ${n}`).join(', ')} } };`;
  const factory = new Function('console', 'workbook', 'event', `"use strict";\n${body}`) as (c: unknown, w: unknown, e: unknown) => { main?: (w: unknown, e?: unknown) => unknown; fns: Record<string, (...a: unknown[]) => unknown> };
  return factory(con, wb, event);
}

let booted = false;

function boot(): void {
  if (booted) return;
  booted = true;
  lockdown();
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  boot();
  if (m.t === 'snapshot') {
    waiting.get(m.id)?.(m.snap);
    waiting.delete(m.id);
    return;
  }
  if (m.t === 'scan') {
    send({ t: 'scanned', id: m.id, names: scan(m.code) } satisfies Out);
    return;
  }
  if (m.t === 'call') {
    try {
      let t = fnCache.get(m.code);
      if (!t) {
        t = table(m.code, consoleFor(m.id)).fns;
        fnCache.set(m.code, t);
      }
      const fn = t[m.name];
      if (!fn) throw new Error(`${m.name} is not a custom function.`);
      let value = await fn(...m.args);
      if (value === undefined) value = '';
      send({ t: 'called', id: m.id, ok: true, value } satisfies Out);
    } catch (err) {
      send({ t: 'called', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Out);
    }
    return;
  }
  const ctx = new Ctx();
  ctx.id = m.id;
  ctx.load(m.snap);
  const con = consoleFor(m.id);
  try {
    const wb = new Workbook(ctx, '');
    const t = table(m.code, con, wb, m.event);
    if (!t.main) throw new Error('Write a function main(workbook) { ... } and run again.');
    const result = await t.main(wb, m.event);
    send({ t: 'done', id: m.id, ok: true, ops: ctx.ops, result } satisfies Out);
  } catch (err) {
    send({ t: 'done', id: m.id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), ops: ctx.ops } satisfies Out);
  }
};
