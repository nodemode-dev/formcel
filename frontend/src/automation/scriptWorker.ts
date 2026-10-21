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
  | { k: 'sort'; sheet: string; r0: number; c0: number; r1: number; c1: number; keys: [number, boolean][]; header: boolean };
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

function parseArea(ref: string): [number, number, number, number] {
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
}

class Ctx {
  sheets = new Map<string, Sheet>();
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

  clear(): Range {
    this.put(this.grid(() => ''), false);
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
