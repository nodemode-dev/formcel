import { Ctx, Range as ORange, Worksheet as OSheet, colName, rangeOf, shiftFormula } from '../automation/officeApi';
import type { Interp } from './interp';
import { has, named, VCollection } from './objects';
import type { VbaHost } from './types';
import { colorIndexToHex, hexToColorIndex, rgbToVba, vbaToHex } from './xlconst';
import { ERR_CODE, HostObject, MISSING, NULLV, VArray, VDate, VError, VbaError, fail, isObj, parseNumber, toBool, toNum, toStr } from './values';

const MAX_ROW = 1048575;
const MAX_COL = 16383;
const KEY = 16384;

const ERR_RX = /^#(N\/A|VALUE!|REF!|DIV\/0!|NUM!|NAME\?|NULL!)$/;

export function isDateFormat(code: string | undefined): boolean {
  if (!code || code === 'General') return false;
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '').replace(/\*./g, '');
  if (/[#0?@]/.test(bare) && !/[ymdhs]/i.test(bare.replace(/[0#?.,%E+\-]/g, ''))) return false;
  return /[ymdhs]/i.test(bare) && !/^[^ymdhs]*E[+-]/.test(bare);
}

function typedCell(v: string): unknown {
  if (v === '') return undefined;
  if (v.startsWith("'")) return v.slice(1);
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v)) return Number(v);
  if (ERR_RX.test(v)) return new VError(ERR_CODE[v] ?? 2015);
  return v;
}

const colIdx = (s: string) => {
  let c = 0;
  for (const ch of s.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
};

function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

export function r1c1ToA1(f: string, row: number, col: number): string {
  return f
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(?<![A-Za-z0-9_.])R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?(?![A-Za-z0-9_(])/g, (_m, r: string | undefined, c: string | undefined) => {
            const rr = r === undefined ? row : r.startsWith('[') ? row + Number(r.slice(1, -1)) : Number(r) - 1;
            const cc = c === undefined ? col : c.startsWith('[') ? col + Number(c.slice(1, -1)) : Number(c) - 1;
            if (rr < 0 || cc < 0) return '#REF!';
            const ra = r !== undefined && !r.startsWith('[') ? '$' : '';
            const ca = c !== undefined && !c.startsWith('[') ? '$' : '';
            return `${ca}${colName(cc)}${ra}${rr + 1}`;
          }),
    )
    .join('');
}

export function a1ToR1c1(f: string, row: number, col: number): string {
  return f
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(?<![A-Za-z0-9_.!'])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (_m, ca: string, c: string, ra: string, r: string) => {
            const cc = colIdx(c);
            const rr = Number(r) - 1;
            const rs = ra ? `R${rr + 1}` : rr === row ? 'R' : `R[${rr - row}]`;
            const cs = ca ? `C${cc + 1}` : cc === col ? 'C' : `C[${cc - col}]`;
            return rs + cs;
          }),
    )
    .join('');
}

export function splitTop(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  let depth = 0;
  for (const c of s) {
    if (c === '"' || c === "'") q = !q;
    if (!q && c === '(') depth++;
    if (!q && c === ')') depth--;
    if (c === ',' && !q && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

interface Clip {
  range: ORange;
  cut: boolean;
}

export class ExcelModel {
  screenUpdating = true;
  displayAlerts = true;
  enableEvents = true;
  calculation = -4105;
  statusBar: unknown = false;
  dirty = false;
  structural = false;
  clip: Clip | null = null;
  active: string;
  sel: { sheet: string; r0: number; c0: number; r1: number; c1: number } | null;
  props = new Map<string, unknown>();
  caller: unknown = undefined;
  title = 'Book1';
  lastFind: { sheet: string; r: number; c: number; args: unknown[] } | null = null;
  eventsPending: { name: string; sheet: string; r0: number; c0: number; r1: number; c1: number }[] = [];

  constructor(readonly ctx: Ctx, readonly it: Interp, readonly host: VbaHost) {
    this.active = ctx.active;
    this.sel = ctx.selection ? { ...ctx.selection } : null;
    this.title = ctx.title || 'Book1';
  }

  sheetNames(): string[] {
    return this.ctx.live().map((s) => s.name);
  }

  hasSheet(name: string): boolean {
    const s = this.ctx.sheets.get(name);
    return !!s && !s.gone;
  }

  findSheet(name: string): string | null {
    const l = name.toLowerCase();
    for (const s of this.ctx.live()) if (s.name.toLowerCase() === l) return s.name;
    return null;
  }

  async sync(force = false): Promise<void> {
    if (!this.ctx.flusher) return;
    if (!(force || this.dirty || this.structural)) return;
    if (!this.ctx.ops.length) {
      this.dirty = false;
      this.structural = false;
      return;
    }
    await this.ctx.flusher();
    this.dirty = false;
    this.structural = false;
    this.ctx.active = this.hasSheet(this.active) ? this.active : this.ctx.live()[0]?.name ?? '';
    this.active = this.ctx.active;
    if (this.sel) this.ctx.selection = this.sel;
  }

  async syncFor(r: ORange): Promise<void> {
    if (this.structural) return this.sync();
    if (!this.dirty) return;
    const d = this.ctx.sheet(r.sheet);
    const rows = r.r1 - r.r0 + 1;
    const cols = r.c1 - r.c0 + 1;
    if (rows * cols > 20000 || r.r1 === MAX_ROW) {
      for (const cell of d.cells.values()) if (cell.f) return this.sync();
      return;
    }
    for (let i = r.r0; i <= r.r1; i++) for (let j = r.c0; j <= r.c1; j++) if (d.cells.get(i * KEY + j)?.f) return this.sync();
  }

  toVba(sheet: string, r: number, c: number, mode: 'value' | 'value2' = 'value'): unknown {
    const d = this.ctx.sheet(sheet);
    const cell = d.cells.get(r * KEY + c);
    if (!cell) return undefined;
    const v = typedCell(cell.v);
    if (mode === 'value' && typeof v === 'number' && isDateFormat(d.formats.get(r * KEY + c))) return new VDate(v);
    return v;
  }

  rawOf(v: unknown): { raw: string; date: boolean } {
    if (v === undefined || v === MISSING || v === NULLV) return { raw: '', date: false };
    if (typeof v === 'number') return { raw: Number.isFinite(v) ? String(v) : '#NUM!', date: false };
    if (typeof v === 'boolean') return { raw: v ? 'TRUE' : 'FALSE', date: false };
    if (typeof v === 'string') return { raw: v, date: false };
    if (v instanceof VDate) return { raw: String(v.serial), date: true };
    if (v instanceof VError) return { raw: v.text, date: false };
    if (v === null) return fail(91);
    if (isObj(v)) {
      const def = (v as HostObject).defaultProp;
      if (def) return { raw: '', date: false };
    }
    return fail(13);
  }

  writeCell(o: ORange, r: number, c: number, v: unknown, asFormula = false): void {
    const { raw, date } = this.rawOf(v);
    if (date) {
      const d = this.ctx.sheet(o.sheet);
      const fmt = d.formats.get(r * KEY + c);
      if (!isDateFormat(fmt)) {
        const serial = Number(raw);
        const code = serial === Math.floor(serial) ? 'm/d/yyyy' : serial < 1 ? 'h:mm:ss AM/PM' : 'm/d/yyyy h:mm';
        o.getCell(r - o.r0, c - o.c0).setNumberFormat(code);
      }
    }
    if (asFormula) o.write(r, c, raw, true);
    else o.write(r, c, raw, false);
    this.dirty = true;
  }

  address(o: ORange, rowAbs = true, colAbs = true, external = false, r1c1 = false): string {
    const cell = (r: number, c: number) => (r1c1 ? `R${r + 1}C${c + 1}` : `${colAbs ? '$' : ''}${colName(c)}${rowAbs ? '$' : ''}${r + 1}`);
    let a: string;
    if (o.r0 === 0 && o.r1 === MAX_ROW) a = `${colAbs ? '$' : ''}${colName(o.c0)}:${colAbs ? '$' : ''}${colName(o.c1)}`;
    else if (o.c0 === 0 && o.c1 === MAX_COL) a = `${rowAbs ? '$' : ''}${o.r0 + 1}:${rowAbs ? '$' : ''}${o.r1 + 1}`;
    else a = o.r0 === o.r1 && o.c0 === o.c1 ? cell(o.r0, o.c0) : `${cell(o.r0, o.c0)}:${cell(o.r1, o.c1)}`;
    return external ? `[${this.title}]${o.sheet}!${a}` : a;
  }

  range(o: ORange, mode: 'cells' | 'rows' | 'columns' = 'cells'): XRange {
    return new XRange(this, [o], mode);
  }

  sheetObj(name: string): XSheet {
    return new XSheet(this, name);
  }

  rangeFrom(t: { sheet: string; r0: number; c0: number; r1: number; c1: number }): XRange {
    return new XRange(this, [new ORange(this.ctx, t.sheet, t.r0, t.c0, t.r1, t.c1)], 'cells');
  }

  activeRange(): XRange | null {
    const s = this.sel;
    if (!s) return null;
    if (!this.hasSheet(s.sheet)) return null;
    return this.range(new ORange(this.ctx, s.sheet, s.r0, s.c0, s.r1, s.c1));
  }

  select(o: ORange): void {
    this.sel = { sheet: o.sheet, r0: o.r0, c0: o.c0, r1: o.r1, c1: o.c1 };
    this.ctx.selection = this.sel;
    if (this.active !== o.sheet) {
      this.active = o.sheet;
      this.ctx.active = o.sheet;
      this.ctx.ops.push({ k: 'sheetOp', sheet: o.sheet, op: 'show' });
    }
    this.ctx.ops.push({ k: 'select', sheet: o.sheet, r0: o.r0, c0: o.c0, r1: o.r1, c1: o.c1 });
  }

  parseRange(arg: unknown, sheet: string): XRange {
    if (arg instanceof XRange) return arg;
    const text = toStr(arg);
    const parts = splitTop(text).map((s) => s.trim()).filter(Boolean);
    const areas: ORange[] = [];
    for (const p of parts) {
      try {
        areas.push(rangeOf(this.ctx, p, sheet));
      } catch {
        fail(1004, 'Method \'Range\' of object \'_Worksheet\' failed');
      }
    }
    if (!areas.length) fail(1004, "Method 'Range' of object '_Worksheet' failed");
    return new XRange(this, areas, 'cells');
  }

  cellRef(v: unknown): [number, number] {
    if (v instanceof XRange) return [v.areas[0].r0, v.areas[0].c0];
    fail(1004);
  }

  async formulaText(a: unknown): Promise<string> {
    if (a instanceof XRange) return a.areas.map((o) => `${quoteSheet(o.sheet)}!${this.address(o)}`).join(',');
    if (a === undefined || a === MISSING) return '';
    if (typeof a === 'number') return String(a);
    if (typeof a === 'boolean') return a ? 'TRUE' : 'FALSE';
    if (typeof a === 'string') return `"${a.replace(/"/g, '""')}"`;
    if (a instanceof VDate) return String(a.serial);
    if (a instanceof VError) return a.text;
    if (a instanceof VArray) {
      const rows = a.dims === 2 ? a.ub[0] - a.lb[0] + 1 : 1;
      const cols = a.dims === 2 ? a.ub[1] - a.lb[1] + 1 : a.data.length;
      const out: string[] = [];
      for (let r = 0; r < rows; r++) {
        const row: string[] = [];
        for (let c = 0; c < cols; c++) row.push(await this.formulaText(a.data[r * cols + c]));
        out.push(row.join(','));
      }
      return `{${out.join(';')}}`;
    }
    if (isObj(a) && (a as HostObject).defaultProp) return this.formulaText(await (a as HostObject).member((a as HostObject).defaultProp as string, [], 0));
    return fail(13);
  }

  parseResult(text: string): unknown {
    const t = text.trim();
    if (t === '') return undefined;
    if (t.startsWith('{') && t.endsWith('}')) {
      const body = t.slice(1, -1);
      const rows: string[][] = [];
      let cur: string[] = [];
      let tok = '';
      let q = false;
      for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '"') {
          q = !q;
          tok += c;
        } else if (!q && c === ',') {
          cur.push(tok);
          tok = '';
        } else if (!q && c === ';') {
          cur.push(tok);
          rows.push(cur);
          cur = [];
          tok = '';
        } else tok += c;
      }
      cur.push(tok);
      rows.push(cur);
      const nr = rows.length;
      const nc = rows[0].length;
      const arr = VArray.make([1, 1], [nr, nc], () => undefined, false);
      rows.forEach((r, i) => r.forEach((x, j) => (arr.data[i * nc + j] = this.parseResult(x))));
      return arr;
    }
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1);
    if (t === 'TRUE') return true;
    if (t === 'FALSE') return false;
    if (ERR_RX.test(t) || t.startsWith('#')) return new VError(ERR_CODE[t] ?? 2015);
    const n = parseNumber(t);
    if (n !== null) return n;
    return t;
  }

  async evalFormula(formula: string, sheet?: string): Promise<unknown> {
    await this.sync();
    const out = await this.host.evalFormula(sheet ?? this.active, formula.startsWith('=') ? formula : `=${formula}`);
    return this.parseResult(out);
  }

  async callSheetFunction(name: string, args: unknown[], strict: boolean): Promise<unknown> {
    const parts: string[] = [];
    let n = args.length;
    while (n > 0 && (args[n - 1] === MISSING || args[n - 1] === undefined)) n--;
    for (let i = 0; i < n; i++) parts.push(await this.formulaText(args[i]));
    const r = await this.evalFormula(`=${name.toUpperCase()}(${parts.join(',')})`);
    if (r instanceof VError) {
      if (strict) fail(1004, `Unable to get the ${name} property of the WorksheetFunction class`);
      return r;
    }
    return r;
  }

  install(it: Interp): void {
    const g = (n: string, f: () => unknown) => it.registerGlobal(n, f);
    const app = new XApplication(this);
    g('application', () => app);
    g('worksheetfunction', () => new XWsf(this, true));
    g('activesheet', () => this.sheetObj(this.active));
    g('activeworkbook', () => new XWorkbook(this));
    g('thisworkbook', () => new XWorkbook(this));
    g('activecell', () => {
      const r = this.activeRange();
      return r ? r.firstCell() : null;
    });
    g('selection', () => this.activeRange());
    g('activewindow', () => new XWindow(this));
    g('range', () => new XRangeFn(this, 'range'));
    g('cells', () => new XRangeFn(this, 'cells'));
    g('rows', () => new XRangeFn(this, 'rows'));
    g('columns', () => new XRangeFn(this, 'columns'));
    g('sheets', () => new XSheets(this, false));
    g('worksheets', () => new XSheets(this, true));
    g('workbooks', () => new XWorkbooks(this));
    g('names', () => new XNames(this));
    g('evaluate', () => new XEvaluate(this));
    g('union', () => new XUnion(this));
    g('intersect', () => new XIntersect(this));
    g('excel', () => app);
    it.extraCreate = (p: string) => {
      if (p === 'excel.application') return app;
      if (p === 'worksheet' || p === 'range') return fail(429);
      return fail(429);
    };
    it.docObject = (m) => {
      if (m.name.toLowerCase() === 'thisworkbook') return new XWorkbook(this);
      const byName = m.sheet ? this.findSheet(m.sheet) : null;
      if (byName) return this.sheetObj(byName);
      const same = this.findSheet(m.name);
      if (same) return this.sheetObj(same);
      const num = /^sheet(\d+)$/i.exec(m.name);
      const list = this.sheetNames();
      if (num && list[Number(num[1]) - 1]) return this.sheetObj(list[Number(num[1]) - 1]);
      return this.sheetObj(list[0]);
    };
    for (const m of it.mods.values()) {
      if (m.kind !== 'document') continue;
      const mod = m;
      g(mod.name, () => it.docObject(mod));
    }
  }
}

class XRangeFn extends HostObject {
  readonly typeName = 'Range';
  constructor(private readonly m: ExcelModel, private readonly what: 'range' | 'cells' | 'rows' | 'columns') {
    super();
  }

  private sheetName(): string {
    return this.m.active;
  }

  async member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): Promise<unknown> {
    const sheet = this.m.sheetObj(this.sheetName());
    if (name === '') return sheet.member(this.what, args, 0);
    const whole = (await sheet.member(this.what, [], 0)) as HostObject;
    return whole.member(name, args, mode, value);
  }

  async enumerate(): Promise<unknown[]> {
    const whole = (await this.m.sheetObj(this.sheetName()).member(this.what, [], 0)) as HostObject;
    return (await whole.enumerate?.()) ?? [];
  }
}

export class XApplication extends HostObject {
  readonly typeName = 'Application';
  constructor(private readonly m: ExcelModel) {
    super();
  }

  async member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): Promise<unknown> {
    const m = this.m;
    switch (name) {
      case 'activesheet':
        return m.sheetObj(m.active);
      case 'activeworkbook':
      case 'thisworkbook':
        return new XWorkbook(m);
      case 'activecell': {
        const r = m.activeRange();
        return r ? r.firstCell() : null;
      }
      case 'selection':
        return m.activeRange();
      case 'workbooks':
        return args.length ? new XWorkbooks(m).member('', args, 0) : new XWorkbooks(m);
      case 'sheets':
        return args.length ? new XSheets(m, false).member('', args, 0) : new XSheets(m, false);
      case 'worksheets':
        return args.length ? new XSheets(m, true).member('', args, 0) : new XSheets(m, true);
      case 'range':
      case 'cells':
      case 'rows':
      case 'columns':
        return m.sheetObj(m.active).member(name, args, 0);
      case 'names':
        return new XNames(m);
      case 'worksheetfunction':
        return new XWsf(m, true);
      case 'screenupdating':
        if (mode === 0) return m.screenUpdating;
        m.screenUpdating = toBool(value);
        return undefined;
      case 'displayalerts':
        if (mode === 0) return m.displayAlerts;
        m.displayAlerts = toBool(value);
        return undefined;
      case 'enableevents':
        if (mode === 0) return m.enableEvents;
        m.enableEvents = toBool(value);
        return undefined;
      case 'calculation':
        if (mode === 0) return m.calculation;
        m.calculation = toNum(value);
        return undefined;
      case 'statusbar':
        if (mode === 0) return m.statusBar;
        m.statusBar = value;
        m.it.emit({ type: 'status', text: value === false || value === undefined ? '' : toStr(value) });
        return undefined;
      case 'calculate':
      case 'calculatefull':
      case 'calculatefullrebuild':
        await m.sync(true);
        return undefined;
      case 'run': {
        const [macro, ...rest] = args;
        let mn = toStr(macro);
        const bang = mn.lastIndexOf('!');
        if (bang >= 0) mn = mn.slice(bang + 1);
        return m.it.runProc(mn, rest.filter((x) => x !== MISSING));
      }
      case 'inputbox': {
        const [prompt, title, def, , , , , type] = named(args, ['prompt', 'title', 'default', 'left', 'top', 'helpfile', 'helpcontextid', 'type']);
        const t = has(type) ? toNum(type) : 1;
        const r = await m.host.inputBox(has(prompt) ? toStr(prompt) : '', has(title) ? toStr(title) : 'Input', has(def) ? toStr(def) : '');
        if (r === null) return false;
        if (t === 8) return m.parseRange(r, m.active);
        if (t === 1) {
          const n = parseNumber(r);
          return n === null ? fail(13) : n;
        }
        return r;
      }
      case 'evaluate':
        return new XEvaluate(m).member('', args, 0);
      case 'union':
        return new XUnion(m).member('', args, 0);
      case 'intersect':
        return new XIntersect(m).member('', args, 0);
      case 'caller':
        return m.caller;
      case 'volatile':
      case 'ontime':
      case 'onkey':
      case 'wait':
      case 'sendkeys':
      case 'goto':
        if (name === 'goto' && args[0] instanceof XRange) args[0].select();
        return name === 'wait' ? true : undefined;
      case 'name':
        return 'FormCel';
      case 'version':
        return '16.0';
      case 'build':
        return 0;
      case 'operatingsystem':
        return 'Windows (64-bit) NT 10.00';
      case 'username':
        return 'user';
      case 'path':
        return '';
      case 'pathseparator':
        return '/';
      case 'decimalseparator':
        return '.';
      case 'thousandsseparator':
        return ',';
      case 'usesystemseparators':
        return true;
      case 'hwnd':
        return 0;
      case 'cutcopymode':
        if (mode === 0) return m.clip ? (m.clip.cut ? 2 : 1) : false;
        if (!toBool(value)) m.clip = null;
        return undefined;
      case 'quit':
        throw new VbaError(0, 'Quit');
      case 'getopenfilename':
      case 'getsavasfilename':
      case 'getsaveasfilename':
        return false;
      case 'application':
      case 'parent':
        return this;
      case 'activewindow':
        return new XWindow(m);
      case 'international':
        return name === 'international' && args.length ? ({ 3: '.', 4: ',', 5: ',' } as Record<number, string>)[toNum(args[0])] ?? '' : undefined;
      case 'worksheetfunctions':
        return undefined;
      default: {
        if (mode !== 0) {
          m.props.set(name, value);
          return undefined;
        }
        if (m.props.has(name)) return m.props.get(name);
        if (DUMB.has(name)) return DUMB.get(name);
        if (/^[a-z][a-z0-9.]*$/.test(name) && !['cursor'].includes(name)) return m.callSheetFunction(name, args, false);
        return fail(438);
      }
    }
  }
}

const DUMB = new Map<string, unknown>([
  ['cursor', -4143],
  ['enablecancelkey', 0],
  ['displaystatusbar', true],
  ['displayformulabar', true],
  ['interactive', true],
  ['asktoupdatelinks', true],
  ['ignoreremoterequests', false],
  ['displayscrollbars', true],
  ['precisionasdisplayed', false],
  ['iteration', false],
  ['maxiterations', 100],
  ['maxchange', 0.001],
  ['screenupdating', true],
  ['calculateBeforeSave', true],
  ['defaultfilepath', ''],
  ['enableanimations', false],
  ['autocorrect', undefined],
  ['filedialog', undefined],
]);

export class XWsf extends HostObject {
  readonly typeName = 'WorksheetFunction';
  constructor(private readonly m: ExcelModel, private readonly strict: boolean) {
    super();
  }

  member(name: string, args: unknown[], mode: 0 | 1 | 2): Promise<unknown> | unknown {
    if (mode !== 0 || name === '') return fail(438);
    return this.m.callSheetFunction(name, args, this.strict);
  }
}

class XEvaluate extends HostObject {
  readonly typeName = 'Evaluate';
  constructor(private readonly m: ExcelModel) {
    super();
  }

  async member(_n: string, args: unknown[], _mode?: 0 | 1 | 2): Promise<unknown> {
    const t = toStr(args[0]).trim();
    if (/^(\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?|[A-Za-z_][\w.]*|'[^']+'!.+|[A-Za-z_][\w]*!.+)$/.test(t) && !/[()+*/^&<>=]/.test(t)) {
      try {
        return this.m.parseRange(t, this.m.active);
      } catch {
        return fail(1004, 'Method \'Range\' of object \'_Worksheet\' failed');
      }
    }
    return this.m.evalFormula(t);
  }
}

class XUnion extends HostObject {
  readonly typeName = 'Union';
  constructor(private readonly m: ExcelModel) {
    super();
  }

  member(_n: string, args: unknown[], _mode?: 0 | 1 | 2): unknown {
    const areas: ORange[] = [];
    for (const a of args) if (a instanceof XRange) areas.push(...a.areas);
    if (!areas.length) fail(1004);
    return new XRange(this.m, areas, 'cells');
  }
}

class XIntersect extends HostObject {
  readonly typeName = 'Intersect';
  constructor(private readonly m: ExcelModel) {
    super();
  }

  member(_n: string, args: unknown[], _mode?: 0 | 1 | 2): unknown {
    let cur: ORange | undefined;
    for (const a of args) {
      if (!(a instanceof XRange)) continue;
      const o = a.areas[0];
      if (!cur) cur = o;
      else cur = cur.getIntersection(o);
      if (!cur) return null;
    }
    return cur ? new XRange(this.m, [cur], 'cells') : null;
  }
}

class XWindow extends HostObject {
  readonly typeName = 'Window';
  constructor(private readonly m: ExcelModel) {
    super();
  }

  member(name: string, _args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    const m = this.m;
    switch (name) {
      case 'freezepanes':
        if (mode === 0) return false;
        if (toBool(value) && m.sel) {
          m.ctx.ops.push({ k: 'sheetOp', sheet: m.sel.sheet, op: 'freeze', rows: m.sel.r0, cols: m.sel.c0 });
        } else if (m.sel) m.ctx.ops.push({ k: 'sheetOp', sheet: m.sel.sheet, op: 'freeze', rows: 0, cols: 0 });
        return undefined;
      case 'displaygridlines':
        if (mode === 0) return m.ctx.sheet(m.active).grid;
        m.ctx.ops.push({ k: 'sheetOp', sheet: m.active, op: 'grid', on: toBool(value) });
        return undefined;
      case 'activecell': {
        const r = m.activeRange();
        return r ? r.firstCell() : null;
      }
      case 'selection':
        return m.activeRange();
      case 'zoom':
        if (mode === 0) return 100;
        return undefined;
      case 'scrollrow':
      case 'scrollcolumn':
        return mode === 0 ? 1 : undefined;
      case 'activesheet':
        return m.sheetObj(m.active);
      case 'windowstate':
        return mode === 0 ? -4143 : undefined;
      default:
        return mode === 0 ? undefined : undefined;
    }
  }
}

export class XWorkbooks extends HostObject {
  readonly typeName = 'Workbooks';
  constructor(private readonly m: ExcelModel) {
    super();
  }

  member(name: string, args: unknown[], _mode?: 0 | 1 | 2): unknown {
    switch (name) {
      case '':
      case 'item': {
        const k = args[0];
        if (typeof k === 'string') {
          const t = k.toLowerCase().replace(/\.(xlsx|xlsm|xls)$/, '');
          if (this.m.title.toLowerCase().replace(/\.(xlsx|xlsm|xls)$/, '') !== t) fail(9);
        } else if (toNum(k) !== 1) fail(9);
        return new XWorkbook(this.m);
      }
      case 'count':
        return 1;
      case 'open':
      case 'add':
        return fail(1004, 'FormCel runs macros on the open workbook only.');
      case 'close':
        return undefined;
      default:
        return fail(438);
    }
  }

  enumerate(): unknown[] {
    return [new XWorkbook(this.m)];
  }
}

export class XWorkbook extends HostObject {
  readonly typeName = 'Workbook';
  constructor(private readonly m: ExcelModel) {
    super();
  }

  identity(): string {
    return 'wb';
  }

  async member(name: string, args: unknown[], mode?: 0 | 1 | 2): Promise<unknown> {
    const m = this.m;
    switch (name) {
      case 'name':
        return m.title;
      case 'fullname':
        return m.title;
      case 'path':
        return '';
      case 'sheets':
        return args.length ? new XSheets(m, false).member('', args, 0) : new XSheets(m, false);
      case 'worksheets':
        return args.length ? new XSheets(m, true).member('', args, 0) : new XSheets(m, true);
      case 'charts':
        return new XSheets(m, false, true);
      case 'names':
        return new XNames(m);
      case 'activesheet':
        return m.sheetObj(m.active);
      case 'save':
        await m.sync(true);
        await m.host.save?.();
        return undefined;
      case 'saveas':
      case 'savecopyas':
      case 'close':
      case 'activate':
      case 'protect':
      case 'unprotect':
      case 'refreshall':
      case 'printout':
      case 'printpreview':
        return undefined;
      case 'saved':
        if (mode === 0) return true;
        return undefined;
      case 'application':
      case 'parent':
        return new XApplication(m);
      case 'windows':
        return new XWindow(m);
      case 'codename':
        return 'ThisWorkbook';
      case 'readonly':
        return false;
      case 'fileformat':
        return 51;
      case 'date1904':
        return false;
      case 'hasvbproject':
        return true;
      case 'vbproject':
        return fail(1004, 'Programmatic access to the Visual Basic Project is not trusted');
      case 'range':
      case 'cells':
        return m.sheetObj(m.active).member(name, args, 0);
      default:
        return fail(438);
    }
  }
}

export class XSheets extends HostObject {
  readonly typeName = 'Sheets';
  constructor(private readonly m: ExcelModel, _onlyWorksheets: boolean, private readonly charts = false) {
    super();
  }

  private list(): string[] {
    if (this.charts) return [];
    return this.m.ctx.live().map((s) => s.name);
  }

  async member(name: string, args: unknown[], _mode?: 0 | 1 | 2): Promise<unknown> {
    const m = this.m;
    switch (name) {
      case '':
      case 'item': {
        const k = args[0];
        if (k instanceof VArray) {
          const names = k.data.map((x) => toStr(x));
          return new XSheetGroup(m, names);
        }
        if (typeof k === 'string') {
          const n = m.findSheet(k);
          if (!n) fail(9);
          return m.sheetObj(n);
        }
        const i = Math.round(toNum(k));
        const l = this.list();
        if (i < 1 || i > l.length) fail(9);
        return m.sheetObj(l[i - 1]);
      }
      case 'count':
        return this.list().length;
      case 'add': {
        const [before, after, count] = named(args, ['before', 'after', 'count', 'type']);
        const n = has(count) ? toNum(count) : 1;
        let last: XSheet | null = null;
        const wb = new OSheet(m.ctx, m.active).getWorkbook();
        for (let k = 0; k < n; k++) {
          const created = wb.addWorksheet();
          const nm = created.getName();
          const live = m.ctx.live().map((s) => s.name);
          let pos = live.indexOf(m.active);
          if (has(before) && before instanceof XSheet) pos = live.indexOf(before.name);
          else if (has(after) && after instanceof XSheet) pos = live.indexOf(after.name) + 1;
          else pos = live.indexOf(m.active);
          created.setPosition(Math.max(0, pos));
          created.activate();
          m.active = nm;
          m.ctx.active = nm;
          m.structural = true;
          last = m.sheetObj(nm);
        }
        return last;
      }
      case 'copy':
      case 'move':
        return undefined;
      case 'delete':
        for (const n of this.list()) m.sheetObj(n).member('delete', [], 0);
        return undefined;
      case 'select':
        return undefined;
      case 'visible':
        return undefined;
      default:
        return fail(438);
    }
  }

  enumerate(): unknown[] {
    return this.list().map((n) => this.m.sheetObj(n));
  }
}

class XSheetGroup extends HostObject {
  readonly typeName = 'Sheets';
  constructor(private readonly m: ExcelModel, private readonly names: string[]) {
    super();
  }

  member(name: string): unknown {
    if (name === 'select') return undefined;
    if (name === 'count') return this.names.length;
    if (name === 'copy') return undefined;
    return fail(438);
  }

  enumerate(): unknown[] {
    return this.names.map((n) => this.m.sheetObj(n));
  }
}

export class XNames extends HostObject {
  readonly typeName = 'Names';
  constructor(private readonly m: ExcelModel, _scope?: string) {
    super();
  }

  private keys(): string[] {
    return [...this.m.ctx.names.keys()];
  }

  member(name: string, args: unknown[]): unknown {
    const m = this.m;
    switch (name) {
      case '':
      case 'item': {
        const k = args[0];
        const keys = this.keys();
        if (typeof k === 'string') {
          const hit = keys.find((x) => x.toLowerCase() === k.toLowerCase());
          if (!hit) fail(1004, 'Method \'Item\' of object \'Names\' failed');
          return new XName(m, hit);
        }
        const i = toNum(k);
        if (i < 1 || i > keys.length) fail(9);
        return new XName(m, keys[i - 1]);
      }
      case 'count':
        return this.keys().length;
      case 'add': {
        const [nm, refers] = named(args, ['name', 'refersto', 'visible']);
        const n = toStr(nm);
        const ref = refers instanceof XRange ? `=${quoteSheet(refers.areas[0].sheet)}!${m.address(refers.areas[0])}` : toStr(refers);
        const f = ref.startsWith('=') ? ref : `=${ref}`;
        m.ctx.names.set(n, f);
        m.ctx.ops.push({ k: 'name', name: n, refers: f });
        m.dirty = true;
        return new XName(m, n);
      }
      default:
        return fail(438);
    }
  }

  enumerate(): unknown[] {
    return this.keys().map((k) => new XName(this.m, k));
  }
}

class XName extends HostObject {
  readonly typeName = 'Name';
  constructor(private readonly m: ExcelModel, private readonly name: string) {
    super();
    this.defaultProp = 'name';
  }

  member(n: string, _args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    const m = this.m;
    switch (n) {
      case 'name':
        return this.name;
      case 'refersto': {
        const f = m.ctx.names.get(this.name) ?? '';
        if (mode === 0) return f.startsWith('=') ? f : `=${f}`;
        const nf = toStr(value);
        m.ctx.names.set(this.name, nf);
        m.ctx.ops.push({ k: 'name', name: this.name, refers: nf });
        return undefined;
      }
      case 'referstorange':
        return m.parseRange((m.ctx.names.get(this.name) ?? '').replace(/^=/, ''), m.active);
      case 'delete':
        m.ctx.names.delete(this.name);
        m.ctx.ops.push({ k: 'name', name: this.name, refers: '' });
        return undefined;
      case 'visible':
        return true;
      default:
        return fail(438);
    }
  }
}

export class XSheet extends HostObject {
  readonly typeName = 'Worksheet';
  constructor(private readonly m: ExcelModel, readonly name: string) {
    super();
  }

  identity(): string {
    return `sheet:${this.name}`;
  }

  private o(): OSheet {
    return new OSheet(this.m.ctx, this.name);
  }

  private mkRange(args: unknown[]): XRange {
    const m = this.m;
    if (args.length === 0) return new XRange(m, [this.o().getUsedRange()], 'cells');
    if (args.length >= 2 && args[1] !== MISSING && args[1] !== undefined) {
      const a = args[0] instanceof XRange ? args[0] : m.parseRange(args[0], this.name);
      const b = args[1] instanceof XRange ? args[1] : m.parseRange(args[1], this.name);
      const x = a.areas[0];
      const y = b.areas[0];
      return new XRange(m, [new ORange(m.ctx, x.sheet, Math.min(x.r0, y.r0), Math.min(x.c0, y.c0), Math.max(x.r1, y.r1), Math.max(x.c1, y.c1))], 'cells');
    }
    if (args[0] instanceof XRange) return args[0];
    return m.parseRange(args[0], this.name);
  }

  async member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): Promise<unknown> {
    const m = this.m;
    const ctx = m.ctx;
    const s = ctx.sheet(this.name);
    switch (name) {
      case 'name':
      case 'codename':
        if (mode === 0 || name === 'codename') return this.name;
        {
          const old = this.name;
          this.o().setName(toStr(value));
          (this as { name: string }).name = toStr(value).slice(0, 31);
          if (m.active === old) m.active = this.name;
          if (m.sel && m.sel.sheet === old) m.sel.sheet = this.name;
          m.structural = true;
        }
        return undefined;
      case 'range':
        return this.mkRange(args);
      case 'cells': {
        const whole = new XRange(m, [new ORange(ctx, this.name, 0, 0, MAX_ROW, MAX_COL)], 'cells');
        return args.length ? whole.member('cells', args, 0) : whole;
      }
      case 'rows':
      case 'columns': {
        const whole = new XRange(m, [new ORange(ctx, this.name, 0, 0, MAX_ROW, MAX_COL)], name === 'rows' ? 'rows' : 'columns');
        return args.length ? whole.member('item', args, 0) : whole;
      }
      case 'usedrange': {
        await m.sync();
        return new XRange(m, [this.o().getUsedRange()], 'cells');
      }
      case 'activate':
      case 'select':
        m.active = this.name;
        ctx.active = this.name;
        ctx.ops.push({ k: 'sheetOp', sheet: this.name, op: 'show' });
        return undefined;
      case 'delete':
        if (m.ctx.live().length < 2) fail(1004, 'A workbook must contain at least one visible worksheet.');
        this.o().delete();
        if (m.active === this.name) m.active = ctx.active;
        m.structural = true;
        return undefined;
      case 'visible':
        if (mode === 0) return s.visible === 'Visible' ? -1 : s.visible === 'Hidden' ? 0 : 2;
        {
          const v = toNum(typeof value === 'boolean' ? (value ? -1 : 0) : value);
          this.o().setVisibility(v === -1 ? 'Visible' : v === 2 ? 'VeryHidden' : 'Hidden');
        }
        return undefined;
      case 'index':
        return ctx.live().findIndex((x) => x.name === this.name) + 1;
      case 'next': {
        const l = ctx.live();
        const i = l.findIndex((x) => x.name === this.name);
        return i + 1 < l.length ? m.sheetObj(l[i + 1].name) : null;
      }
      case 'previous': {
        const l = ctx.live();
        const i = l.findIndex((x) => x.name === this.name);
        return i > 0 ? m.sheetObj(l[i - 1].name) : null;
      }
      case 'parent':
        return new XWorkbook(m);
      case 'application':
        return new XApplication(m);
      case 'tab':
        return new XTab(m, this.name);
      case 'copy': {
        const [before, after] = named(args, ['before', 'after']);
        const wb = this.o().getWorkbook();
        const created = wb.addWorksheet();
        const live = ctx.live().map((x) => x.name);
        let pos = live.length - 1;
        if (before instanceof XSheet) pos = live.indexOf(before.name);
        else if (after instanceof XSheet) pos = live.indexOf(after.name) + 1;
        created.setPosition(Math.max(0, Math.min(pos, live.length - 1)));
        const used = this.o().getUsedRange();
        created.getRange(used.getAddressLocal()).copyFrom(used, 'All');
        m.structural = true;
        return m.sheetObj(created.getName());
      }
      case 'move':
        m.structural = true;
        return undefined;
      case 'protect':
      case 'unprotect':
      case 'calculate':
      case 'enableselection':
      case 'pagesetup':
      case 'outline':
      case 'shapes':
      case 'comments':
      case 'hyperlinks':
      case 'chartobjects':
      case 'listobjects':
      case 'pivottables':
        if (name === 'calculate') await m.sync(true);
        if (name === 'shapes' || name === 'chartobjects' || name === 'listobjects' || name === 'comments' || name === 'hyperlinks' || name === 'pivottables') return new VCollection();
        return undefined;
      case 'autofiltermode':
        if (mode === 0) return false;
        if (!toBool(value)) this.o().getAutoFilter().remove();
        return undefined;
      case 'showalldata':
        this.o().getAutoFilter().clearCriteria();
        return undefined;
      case 'names':
        return new XNames(m, this.name);
      case 'evaluate':
        return m.evalFormula(toStr(args[0]), this.name);
      case 'standardwidth':
        return 8.43;
      case 'displaypagebreaks':
      case 'enableformatconditionscalculation':
        return mode === 0 ? false : undefined;
      case 'cells.clear':
        return undefined;
      default:
        return fail(438);
    }
  }
}

class XTab extends HostObject {
  readonly typeName = 'Tab';
  constructor(private readonly m: ExcelModel, private readonly sheet: string) {
    super();
  }

  member(name: string, _a: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    if (name === 'color') {
      if (mode === 0) {
        const t = this.m.ctx.sheet(this.sheet).tab;
        return t ? parseInt(t.slice(0, 2), 16) + parseInt(t.slice(2, 4), 16) * 256 + parseInt(t.slice(4, 6), 16) * 65536 : false;
      }
      new OSheet(this.m.ctx, this.sheet).setTabColor(value === false ? '' : `#${vbaToHex(toNum(value))}`);
      return undefined;
    }
    if (name === 'colorindex') {
      if (mode === 1 && toNum(value) === -4142) new OSheet(this.m.ctx, this.sheet).setTabColor('');
      return undefined;
    }
    return fail(438);
  }
}

export class XRange extends HostObject {
  readonly typeName = 'Range';
  copiedFrom: ORange | null = null;

  constructor(readonly m: ExcelModel, readonly areas: ORange[], readonly mode: 'cells' | 'rows' | 'columns') {
    super();
    this.defaultProp = 'value';
  }

  identity(): string {
    return this.areas.map((a) => `${a.sheet}!${a.r0},${a.c0},${a.r1},${a.c1}`).join('|');
  }

  get o(): ORange {
    return this.areas[0];
  }

  firstCell(): XRange {
    const o = this.o;
    return new XRange(this.m, [new ORange(this.m.ctx, o.sheet, o.r0, o.c0, o.r0, o.c0)], 'cells');
  }

  select(): void {
    this.m.select(this.o);
  }

  private count(): number {
    if (this.mode === 'rows') return this.areas.reduce((n, a) => n + (a.r1 - a.r0 + 1), 0);
    if (this.mode === 'columns') return this.areas.reduce((n, a) => n + (a.c1 - a.c0 + 1), 0);
    return this.areas.reduce((n, a) => n + (a.r1 - a.r0 + 1) * (a.c1 - a.c0 + 1), 0);
  }

  private each(fn: (a: ORange) => void): void {
    for (const a of this.areas) fn(a);
  }

  private bounded(a: ORange): ORange {
    if (a.r1 !== MAX_ROW && a.c1 !== MAX_COL) return a;
    const u = a.getUsedRange(false);
    return new ORange(a.ctx, a.sheet, a.r0, a.c0, a.r1 === MAX_ROW ? Math.max(u.r1, a.r0) : a.r1, a.c1 === MAX_COL ? Math.max(u.c1, a.c0) : a.c1);
  }

  private valueOf(mode: 'value' | 'value2'): unknown {
    const a = this.bounded(this.o);
    const rows = a.r1 - a.r0 + 1;
    const cols = a.c1 - a.c0 + 1;
    if (rows * cols > 5_000_000) fail(7);
    if (rows === 1 && cols === 1) return this.m.toVba(a.sheet, a.r0, a.c0, mode);
    const arr = VArray.make([1, 1], [rows, cols], () => undefined, false);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) arr.data[r * cols + c] = this.m.toVba(a.sheet, a.r0 + r, a.c0 + c, mode);
    return arr;
  }

  private setValue(v: unknown, formula: boolean): void {
    const m = this.m;
    this.each((a) => {
      const rows = a.r1 - a.r0 + 1;
      const cols = a.c1 - a.c0 + 1;
      if (v instanceof VArray) {
        const vr = v.dims === 2 ? v.ub[0] - v.lb[0] + 1 : 1;
        const vc = v.dims === 2 ? v.ub[1] - v.lb[1] + 1 : v.data.length;
        if (rows === 1 && cols === 1 && (vr > 1 || vc > 1) && !(this.areas.length > 1)) {
          for (let r = 0; r < vr; r++) for (let c = 0; c < vc; c++) m.writeCell(a, a.r0 + r, a.c0 + c, v.data[r * vc + c], formula);
          return;
        }
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const x = r < vr && c < vc ? v.data[r * vc + c] : new VError(2042);
            m.writeCell(a, a.r0 + r, a.c0 + c, x, formula);
          }
        return;
      }
      const big = rows * cols;
      if (big > 2_000_000) fail(7);
      const text = typeof v === 'string' && formula && v.startsWith('=');
      for (let r = a.r0; r <= a.r1; r++)
        for (let c = a.c0; c <= a.c1; c++) {
          if (text && (rows > 1 || cols > 1)) m.writeCell(a, r, c, shiftFormula(v as string, r - a.r0, c - a.c0), true);
          else m.writeCell(a, r, c, v, formula);
        }
    });
  }

  private styleAll(patch: string): void {
    this.each((a) => a.getFormat().apply(patch));
  }

  async member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): Promise<unknown> {
    const m = this.m;
    const ctx = m.ctx;
    const o = this.o;
    switch (name) {
      case '':
        if (args.length === 0) {
          if (mode === 0) {
            await m.syncFor(o);
            return this.valueOf('value');
          }
          this.setValue(value, false);
          return undefined;
        }
        return this.member('item', args, mode, value);
      case 'value':
      case 'value2':
        if (mode === 0) {
          if (args.length) return fail(450);
          await m.syncFor(this.bounded(o));
          return this.valueOf(name === 'value' ? 'value' : 'value2');
        }
        this.setValue(value, false);
        return undefined;
      case 'formula':
      case 'formulalocal':
      case 'formular1c1':
      case 'formular1c1local':
      case 'formulaarray': {
        const r1 = name.startsWith('formular1c1');
        if (mode === 0) {
          const a = o;
          const f = (r: number, c: number) => {
            const cell = ctx.sheet(a.sheet).cells.get(r * KEY + c);
            const raw = cell?.f ?? (cell ? (cell.v.startsWith("'") ? cell.v.slice(1) : cell.v) : '');
            return r1 && cell?.f ? a1ToR1c1(raw, r, c) : raw;
          };
          const rows = Math.min(a.r1, a.r0 + 100000) - a.r0 + 1;
          const cols = a.c1 - a.c0 + 1;
          if (rows === 1 && cols === 1) {
            const t = f(a.r0, a.c0);
            return t === '' ? '' : this.m.toVba(a.sheet, a.r0, a.c0) instanceof VDate && !t.startsWith('=') ? t : typedFormulaValue(t);
          }
          const arr = VArray.make([1, 1], [rows, cols], () => '', false);
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) arr.data[r * cols + c] = typedFormulaValue(f(a.r0 + r, a.c0 + c));
          return arr;
        }
        if (r1) {
          this.each((a) => {
            const grid = value instanceof VArray ? value : null;
            for (let r = a.r0; r <= a.r1; r++)
              for (let c = a.c0; c <= a.c1; c++) {
                const src = grid ? (grid.data[(r - a.r0) * (grid.dims === 2 ? grid.ub[1] - grid.lb[1] + 1 : grid.data.length) + (c - a.c0)] ?? '') : value;
                const t = typeof src === 'string' ? src : src;
                m.writeCell(a, r, c, typeof t === 'string' && t.startsWith('=') ? r1c1ToA1(t, r, c) : t, true);
              }
          });
        } else this.setValue(value, true);
        return undefined;
      }
      case 'text': {
        await m.syncFor(this.bounded(o));
        const cell = ctx.sheet(o.sheet).cells.get(o.r0 * KEY + o.c0);
        return cell?.t ?? '';
      }
      case 'address': {
        const [rowAbs, colAbs, style, external] = named(args, ['rowabsolute', 'columnabsolute', 'referencestyle', 'external', 'relativeto']);
        return this.areas.map((a) => m.address(a, has(rowAbs) ? toBool(rowAbs) : true, has(colAbs) ? toBool(colAbs) : true, has(external) && toBool(external), has(style) && toNum(style) === -4150)).join(',');
      }
      case 'addresslocal':
        return this.areas.map((a) => m.address(a)).join(',');
      case 'row':
        return o.r0 + 1;
      case 'column':
        return o.c0 + 1;
      case 'count':
        return this.count();
      case 'countlarge':
        return this.count();
      case 'rows':
        if (args.length) return this.member('item', args, 0);
        return new XRange(m, this.areas, 'rows');
      case 'columns':
        if (args.length) return this.member('item', args, 0);
        return new XRange(m, this.areas, 'columns');
      case 'item': {
        if (args.length === 1) {
          const k = args[0];
          if (this.mode === 'rows') return this.slice(true, Math.round(toNum(k)));
          if (this.mode === 'columns') return this.slice(false, typeof k === 'string' ? colIdx(k) + 1 : Math.round(toNum(k)));
          const i = Math.round(toNum(k));
          const w = o.c1 - o.c0 + 1;
          const total = (o.r1 - o.r0 + 1) * w;
          if (i < 1 || i > total) fail(1004, 'Application-defined or object-defined error');
          const r = Math.floor((i - 1) / w);
          const c = (i - 1) % w;
          return new XRange(m, [new ORange(ctx, o.sheet, o.r0 + r, o.c0 + c, o.r0 + r, o.c0 + c)], 'cells');
        }
        return this.member('cells', args, 0);
      }
      case 'cells': {
        if (args.length === 0) return new XRange(m, this.areas, 'cells');
        if (args.length === 1 || args[1] === MISSING) return this.member('item', [args[0]], 0);
        const r = Math.round(toNum(args[0])) - 1;
        const c = typeof args[1] === 'string' ? colIdx(args[1]) : Math.round(toNum(args[1])) - 1;
        if (r < 0 || c < 0) fail(1004, 'Application-defined or object-defined error');
        return new XRange(m, [new ORange(ctx, o.sheet, o.r0 + r, o.c0 + c, o.r0 + r, o.c0 + c)], 'cells');
      }
      case 'range': {
        const sub = m.parseRange(args[0], o.sheet);
        const b = args[1] !== undefined && args[1] !== MISSING ? m.parseRange(args[1], o.sheet).o : null;
        const x = sub.o;
        const r0 = o.r0 + x.r0;
        const c0 = o.c0 + x.c0;
        const bb = b ? new ORange(ctx, o.sheet, o.r0 + b.r0, o.c0 + b.c0, o.r0 + b.r1, o.c0 + b.c1) : null;
        const first = new ORange(ctx, o.sheet, r0, c0, o.r0 + x.r1, o.c0 + x.c1);
        if (!bb) return new XRange(m, [first], 'cells');
        return new XRange(m, [new ORange(ctx, o.sheet, Math.min(first.r0, bb.r0), Math.min(first.c0, bb.c0), Math.max(first.r1, bb.r1), Math.max(first.c1, bb.c1))], 'cells');
      }
      case 'offset': {
        const [dr, dc] = named(args, ['rowoffset', 'columnoffset']);
        const r = has(dr) ? Math.round(toNum(dr)) : 0;
        const c = has(dc) ? Math.round(toNum(dc)) : 0;
        return new XRange(m, this.areas.map((a) => {
          if (a.r0 + r < 0 || a.c0 + c < 0 || a.r1 + r > MAX_ROW || a.c1 + c > MAX_COL) fail(1004, 'Application-defined or object-defined error');
          return a.getOffsetRange(r, c);
        }), this.mode);
      }
      case 'resize': {
        const [nr, nc] = named(args, ['rowsize', 'columnsize']);
        const rr = has(nr) ? Math.round(toNum(nr)) : o.r1 - o.r0 + 1;
        const cc = has(nc) ? Math.round(toNum(nc)) : o.c1 - o.c0 + 1;
        if (rr < 1 || cc < 1) fail(1004, 'Application-defined or object-defined error');
        return new XRange(m, [new ORange(ctx, o.sheet, o.r0, o.c0, o.r0 + rr - 1, o.c0 + cc - 1)], this.mode);
      }
      case 'end': {
        await m.syncFor(new ORange(ctx, o.sheet, 0, 0, MAX_ROW, MAX_COL));
        return this.end(toNum(args[0]));
      }
      case 'currentregion': {
        await m.sync();
        return this.currentRegion();
      }
      case 'entirerow':
        return new XRange(m, this.areas.map((a) => new ORange(ctx, a.sheet, a.r0, 0, a.r1, MAX_COL)), 'cells');
      case 'entirecolumn':
        return new XRange(m, this.areas.map((a) => new ORange(ctx, a.sheet, 0, a.c0, MAX_ROW, a.c1)), 'cells');
      case 'worksheet':
      case 'parent':
        return m.sheetObj(o.sheet);
      case 'application':
        return new XApplication(m);
      case 'areas':
        return new XAreas(m, this.areas);
      case 'select':
        this.select();
        return true;
      case 'activate':
        this.select();
        return true;
      case 'hasformula':
        return !!ctx.sheet(o.sheet).cells.get(o.r0 * KEY + o.c0)?.f;
      case 'numberformat':
      case 'numberformatlocal':
        if (mode === 0) return ctx.sheet(o.sheet).formats.get(o.r0 * KEY + o.c0) ?? 'General';
        this.each((a) => a.setNumberFormat(toStr(value)));
        return undefined;
      case 'font':
        return new XFont(this);
      case 'interior':
        return new XInterior(this);
      case 'borders':
        return args.length ? new XBorder(this, [toNum(args[0])]) : new XBorder(this, [7, 8, 9, 10, 11, 12], true);
      case 'horizontalalignment': {
        if (mode === 0) {
          const h = o.getFormat().getHorizontalAlignment();
          return ({ Left: -4131, Center: -4108, Right: -4152, General: 1 } as Record<string, number>)[h] ?? 1;
        }
        const v = toNum(value);
        const map: Record<number, string> = { [-4131]: 'Left', [-4108]: 'Center', [-4152]: 'Right', 1: 'General', 7: 'CenterAcrossSelection' };
        const to = map[v];
        if (!to) fail(1004, 'Unable to set the HorizontalAlignment property of the Range class');
        this.each((a) => a.getFormat().setHorizontalAlignment(to));
        return undefined;
      }
      case 'verticalalignment': {
        if (mode === 0) {
          const h = o.getFormat().getVerticalAlignment();
          return ({ Top: -4160, Center: -4108, Bottom: -4107 } as Record<string, number>)[h] ?? -4107;
        }
        const to = ({ [-4160]: 'Top', [-4108]: 'Center', [-4107]: 'Bottom' } as Record<number, string>)[toNum(value)];
        if (!to) fail(1004, 'Unable to set the VerticalAlignment property of the Range class');
        this.each((a) => a.getFormat().setVerticalAlignment(to));
        return undefined;
      }
      case 'wraptext':
        if (mode === 0) return o.getFormat().getWrapText();
        this.each((a) => a.getFormat().setWrapText(toBool(value)));
        return undefined;
      case 'indentlevel':
        if (mode === 0) return o.getFormat().getIndentLevel();
        this.each((a) => a.getFormat().setIndentLevel(toNum(value)));
        return undefined;
      case 'orientation':
        if (mode === 0) return 0;
        this.each((a) => a.getFormat().setTextOrientation(toNum(value)));
        return undefined;
      case 'columnwidth':
        if (mode === 0) return Math.round(((o.getFormat().getColumnWidth() - 5) / 7) * 100) / 100;
        this.each((a) => a.getFormat().setColumnWidth(Math.round(toNum(value) * 7 + 5)));
        return undefined;
      case 'rowheight':
        if (mode === 0) return Math.round(o.getFormat().getRowHeight() * 0.75 * 100) / 100;
        this.each((a) => a.getFormat().setRowHeight(Math.round(toNum(value) / 0.75)));
        return undefined;
      case 'width':
        return (o.c1 - o.c0 + 1) * 48;
      case 'height':
        return (o.r1 - o.r0 + 1) * 15;
      case 'left':
      case 'top':
        return 0;
      case 'hidden':
        if (mode === 0) return o.getFormat().getRowHidden() || o.getFormat().getColumnHidden();
        this.each((a) => {
          if (a.r0 === 0 && a.r1 === MAX_ROW) a.getFormat().setColumnHidden(toBool(value));
          else a.getFormat().setRowHidden(toBool(value));
        });
        return undefined;
      case 'autofit':
        this.each((a) => {
          if (this.mode === 'rows' || (a.c0 === 0 && a.c1 === MAX_COL)) a.getFormat().autofitRows();
          else a.getFormat().autofitColumns();
        });
        return true;
      case 'merge':
        this.each((a) => a.merge(has(args[0]) && toBool(args[0])));
        m.structural = true;
        return undefined;
      case 'unmerge':
        this.each((a) => a.unmerge());
        m.structural = true;
        return undefined;
      case 'mergecells':
        if (mode === 0) return false;
        this.each((a) => (toBool(value) ? a.merge(false) : a.unmerge()));
        return undefined;
      case 'clear':
        this.each((a) => a.clear('All'));
        m.dirty = true;
        return undefined;
      case 'clearcontents':
        this.each((a) => a.clear('Contents'));
        m.dirty = true;
        return undefined;
      case 'clearformats':
        this.each((a) => a.clear('Formats'));
        return undefined;
      case 'clearcomments':
      case 'clearhyperlinks':
      case 'clearnotes':
        return undefined;
      case 'delete': {
        const [shift] = named(args, ['shift']);
        this.each((a) => {
          const entire = (a.r0 === 0 && a.r1 === MAX_ROW) || (a.c0 === 0 && a.c1 === MAX_COL);
          const dir = has(shift) ? (toNum(shift) === -4159 ? 'Left' : 'Up') : entire ? (a.c0 === 0 && a.c1 === MAX_COL ? 'Up' : 'Left') : a.c1 - a.c0 >= a.r1 - a.r0 && false ? 'Left' : 'Up';
          a.delete(dir);
        });
        m.structural = true;
        return true;
      }
      case 'insert': {
        const [shift] = named(args, ['shift', 'copyorigin']);
        this.each((a) => {
          const entire = (a.r0 === 0 && a.r1 === MAX_ROW) || (a.c0 === 0 && a.c1 === MAX_COL);
          const dir = has(shift) ? (toNum(shift) === -4161 ? 'Right' : 'Down') : entire ? (a.c0 === 0 && a.c1 === MAX_COL ? 'Down' : 'Right') : 'Down';
          a.insert(dir);
        });
        m.structural = true;
        return this;
      }
      case 'copy': {
        const [dest] = named(args, ['destination']);
        const src = o;
        if (has(dest) && dest instanceof XRange) {
          const t = dest.o;
          new ORange(ctx, t.sheet, t.r0, t.c0, t.r0 + (src.r1 - src.r0), t.c0 + (src.c1 - src.c0)).copyFrom(src, 'All');
          m.dirty = true;
          return true;
        }
        m.clip = { range: src, cut: false };
        return true;
      }
      case 'cut': {
        const [dest] = named(args, ['destination']);
        if (has(dest) && dest instanceof XRange) {
          o.moveTo(dest.o);
          m.structural = true;
          return true;
        }
        m.clip = { range: o, cut: true };
        return true;
      }
      case 'paste': {
        const [dest] = named(args, ['destination']);
        const t = has(dest) && dest instanceof XRange ? dest.o : o;
        return this.pasteFrom(t, 'All', false, false);
      }
      case 'pastespecial': {
        const [paste, , skip, transpose] = named(args, ['paste', 'operation', 'skipblanks', 'transpose']);
        const kind = has(paste) ? toNum(paste) : -4104;
        const type = kind === -4163 || kind === 12 ? 'Values' : kind === -4123 || kind === 11 ? 'Formulas' : kind === -4122 ? 'Formats' : 'All';
        return this.pasteFrom(o, type, has(skip) && toBool(skip), has(transpose) && toBool(transpose));
      }
      case 'autofill': {
        const [dest] = named(args, ['destination', 'type']);
        if (dest instanceof XRange) o.autoFill(dest.o);
        m.structural = true;
        return undefined;
      }
      case 'filldown':
      case 'fillup':
      case 'fillright':
      case 'fillleft': {
        if (name === 'filldown' && o.r1 > o.r0) {
          o.autoFill(new ORange(ctx, o.sheet, o.r0, o.c0, o.r1, o.c1));
        } else if (name === 'fillright' && o.c1 > o.c0) o.autoFill(new ORange(ctx, o.sheet, o.r0, o.c0, o.r1, o.c1));
        m.structural = true;
        return undefined;
      }
      case 'sort': {
        const [k1, o1, k2, , o2, k3, o3, hdr, , matchCase, orient] = named(args, ['key1', 'order1', 'key2', 'type', 'order2', 'key3', 'order3', 'header', 'ordercustom', 'matchcase', 'orientation']);
        const target = this.bounded(o);
        const keys: { key: number; ascending: boolean }[] = [];
        const add = (k: unknown, ord: unknown) => {
          if (!has(k)) return;
          const kr = k instanceof XRange ? k.o : m.parseRange(k, o.sheet).o;
          keys.push({ key: orient !== undefined && has(orient) && toNum(orient) === 2 ? kr.r0 - target.r0 : kr.c0 - target.c0, ascending: !has(ord) || toNum(ord) === 1 });
        };
        add(k1, o1);
        add(k2, o2);
        add(k3, o3);
        if (!keys.length) keys.push({ key: 0, ascending: true });
        const header = has(hdr) ? toNum(hdr) === 1 : false;
        target.getSort().apply(keys, has(matchCase) && toBool(matchCase), header);
        m.structural = true;
        return undefined;
      }
      case 'autofilter': {
        const [field, c1, op, c2] = named(args, ['field', 'criteria1', 'operator', 'criteria2', 'visibledropdown']);
        const ws = new OSheet(ctx, o.sheet);
        const af = ws.getAutoFilter();
        const area = this.bounded(o).getUsedRange();
        if (!has(field)) {
          af.apply(area.r0 === area.r1 && area.c0 === area.c1 ? this.currentRegionRaw() : area);
        } else {
          const tgt = this.bounded(o);
          const col = Math.round(toNum(field)) - 1;
          const vals: string[] = [];
          const push = (c: unknown) => {
            if (c instanceof VArray) c.data.forEach((x) => vals.push(toStr(x)));
            else if (has(c)) vals.push(toStr(c));
          };
          push(c1);
          if (has(op) && toNum(op) === 2) push(c2);
          af.apply(tgt, col, { filterOn: 'Values', values: vals.map((v) => v.replace(/^=/, '')) });
        }
        m.structural = true;
        return undefined;
      }
      case 'find': {
        const [what, after, , lookAt, , dir, matchCase] = named(args, ['what', 'after', 'lookin', 'lookat', 'searchorder', 'searchdirection', 'matchcase', 'matchbyte', 'searchformat']);
        await m.sync();
        const r = this.find(toStr(what), after instanceof XRange ? after.o : null, has(lookAt) ? toNum(lookAt) === 1 : false, has(matchCase) && toBool(matchCase), has(dir) && toNum(dir) === 2 ? -1 : 1);
        m.lastFind = r ? { sheet: r.o.sheet, r: r.o.r0, c: r.o.c0, args: [what, , , lookAt, , dir, matchCase] } : null;
        return r;
      }
      case 'findnext':
      case 'findprevious': {
        const lf = m.lastFind;
        if (!lf) return null;
        const prev = new ORange(ctx, lf.sheet, lf.r, lf.c, lf.r, lf.c);
        const afterArg = args[0] instanceof XRange ? args[0].o : prev;
        const dir = lf.args[5];
        const sign = (name === 'findprevious' ? -1 : 1) * (has(dir) && toNum(dir) === 2 ? -1 : 1);
        const r = this.find(toStr(lf.args[0]), afterArg, has(lf.args[3]) ? toNum(lf.args[3]) === 1 : false, has(lf.args[6]) && toBool(lf.args[6]), sign);
        if (r) m.lastFind = { sheet: r.o.sheet, r: r.o.r0, c: r.o.c0, args: lf.args };
        return r;
      }
      case 'replace': {
        const [what, rep, lookAt, , matchCase] = named(args, ['what', 'replacement', 'lookat', 'searchorder', 'matchcase']);
        let n = 0;
        this.each((a) => (n += a.replaceAll(toStr(what), toStr(rep), { completeMatch: has(lookAt) && toNum(lookAt) === 1, matchCase: has(matchCase) && toBool(matchCase) })));
        m.dirty = true;
        return n > 0;
      }
      case 'specialcells': {
        await m.sync();
        return this.special(toNum(args[0]), has(args[1]) ? toNum(args[1]) : 23);
      }
      case 'removeduplicates': {
        const [cols, hdr] = named(args, ['columns', 'header']);
        const list = cols instanceof VArray ? cols.data.map((x) => toNum(x) - 1) : has(cols) ? [toNum(cols) - 1] : Array.from({ length: o.c1 - o.c0 + 1 }, (_, i) => i);
        o.removeDuplicates(list, has(hdr) ? toNum(hdr) === 1 : false);
        m.structural = true;
        return undefined;
      }
      case 'name':
        return fail(438);
      case 'locked':
      case 'formulahidden':
        return mode === 0 ? true : undefined;
      case 'style':
        return mode === 0 ? 'Normal' : undefined;
      case 'shrinktofit':
      case 'prefixcharacter':
      case 'readingorder':
      case 'addindent':
      case 'comment':
        return mode === 0 ? '' : undefined;
      case 'addcomment':
      case 'hyperlinks':
      case 'validation':
      case 'formatconditions':
      case 'errors':
      case 'characters':
      case 'listobject':
      case 'pivottable':
      case 'sparklinegroups':
      case 'phonetic':
        return new VCollection();
      case 'tostring':
        return this.identity();
      case 'textstocolumns':
      case 'texttocolumns':
        return undefined;
      case 'calculate':
        await m.sync(true);
        return undefined;
      case 'dirty':
        return undefined;
      case 'get_resize':
        return this;
      case 'dependents':
      case 'precedents':
        return fail(1004);
      default:
        return fail(438);
    }
  }

  private slice(rows: boolean, i: number): XRange {
    const o = this.o;
    if (i < 1) fail(1004, 'Application-defined or object-defined error');
    const ctx = this.m.ctx;
    if (rows) return new XRange(this.m, [new ORange(ctx, o.sheet, o.r0 + i - 1, o.c0, o.r0 + i - 1, o.c1)], 'cells');
    return new XRange(this.m, [new ORange(ctx, o.sheet, o.r0, o.c0 + i - 1, o.r1, o.c0 + i - 1)], 'cells');
  }

  private async pasteFrom(target: ORange, type: string, skip: boolean, transpose: boolean): Promise<boolean> {
    const clip = this.m.clip;
    if (!clip) fail(1004, 'Paste method of Worksheet class failed');
    const src = clip.range;
    const rows = transpose ? src.c1 - src.c0 : src.r1 - src.r0;
    const cols = transpose ? src.r1 - src.r0 : src.c1 - src.c0;
    const dst = target.r1 > target.r0 || target.c1 > target.c0 ? target : new ORange(this.m.ctx, target.sheet, target.r0, target.c0, target.r0 + rows, target.c0 + cols);
    dst.copyFrom(src, type, skip, transpose);
    if (clip.cut) {
      src.clear('All');
      this.m.clip = null;
    }
    this.m.dirty = true;
    return true;
  }

  private find(what: string, after: ORange | null, whole: boolean, matchCase: boolean, dir: number): XRange | null {
    const a = this.bounded(this.o);
    const d = this.m.ctx.sheet(a.sheet);
    const hits: [number, number][] = [];
    const want = matchCase ? what : what.toLowerCase();
    for (const [k, cell] of d.cells) {
      const r = Math.floor(k / KEY);
      const c = k % KEY;
      if (r < a.r0 || r > a.r1 || c < a.c0 || c > a.c1) continue;
      const have = matchCase ? cell.t : cell.t.toLowerCase();
      if (whole ? have === want : have.includes(want)) hits.push([r, c]);
    }
    if (!hits.length) return null;
    hits.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    if (dir < 0) hits.reverse();
    let pick = hits[0];
    if (after) {
      const key = after.r0 * KEY + after.c0;
      const next = hits.find((h) => (dir > 0 ? h[0] * KEY + h[1] > key : h[0] * KEY + h[1] < key));
      pick = next ?? hits[0];
    }
    return new XRange(this.m, [new ORange(this.m.ctx, a.sheet, pick[0], pick[1], pick[0], pick[1])], 'cells');
  }

  private special(kind: number, types: number): XRange {
    const a = this.bounded(this.o);
    const d = this.m.ctx.sheet(a.sheet);
    const single = a.r0 === a.r1 && a.c0 === a.c1;
    const area = single ? new ORange(this.m.ctx, a.sheet, 0, 0, MAX_ROW, MAX_COL) : a;
    const scoped = area.getUsedRange(false);
    const picks: [number, number][] = [];
    if (kind === 11) {
      const u = new ORange(this.m.ctx, a.sheet, 0, 0, MAX_ROW, MAX_COL).getUsedRange(false);
      return new XRange(this.m, [new ORange(this.m.ctx, a.sheet, u.r1, u.c1, u.r1, u.c1)], 'cells');
    }
    const box = single ? scoped : a;
    for (let r = box.r0; r <= box.r1; r++)
      for (let c = box.c0; c <= box.c1; c++) {
        const cell = d.cells.get(r * KEY + c);
        if (kind === 4 && (!cell || cell.v === '')) picks.push([r, c]);
        else if (kind === -4123 && cell?.f) {
          const v = typedCell(cell.v);
          const t = typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 4 : v instanceof VError ? 16 : 0;
          if (types & t || t === 0) picks.push([r, c]);
        } else if (kind === 2 && cell && !cell.f && cell.v !== '') {
          const v = typedCell(cell.v);
          const t = typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 4 : 16;
          if (types & t) picks.push([r, c]);
        }
      }
    if (!picks.length) fail(1004, 'No cells were found.');
    return new XRange(this.m, picks.map(([r, c]) => new ORange(this.m.ctx, a.sheet, r, c, r, c)), 'cells');
  }

  private end(dir: number): XRange {
    const o = this.o;
    const d = this.m.ctx.sheet(o.sheet);
    const has2 = (r: number, c: number) => {
      const cell = d.cells.get(r * KEY + c);
      return !!cell && (cell.v !== '' || !!cell.f);
    };
    let r = o.r0;
    let c = o.c0;
    let dr = 0;
    let dc = 0;
    if (dir === -4162) dr = -1;
    else if (dir === -4121) dr = 1;
    else if (dir === -4159) dc = -1;
    else dc = 1;
    const ok = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr <= MAX_ROW && cc <= MAX_COL;
    if (has2(r, c) && ok(r + dr, c + dc) && has2(r + dr, c + dc)) {
      while (ok(r + dr, c + dc) && has2(r + dr, c + dc)) {
        r += dr;
        c += dc;
      }
    } else {
      r += dr;
      c += dc;
      while (ok(r, c) && !has2(r, c)) {
        if (!ok(r + dr, c + dc)) break;
        r += dr;
        c += dc;
      }
      if (!ok(r, c)) {
        r = Math.max(0, Math.min(MAX_ROW, r));
        c = Math.max(0, Math.min(MAX_COL, c));
      }
    }
    return new XRange(this.m, [new ORange(this.m.ctx, o.sheet, r, c, r, c)], 'cells');
  }

  private currentRegionRaw(): ORange {
    const o = this.o;
    const d = this.m.ctx.sheet(o.sheet);
    const filled = (r: number, c: number) => {
      const cell = d.cells.get(r * KEY + c);
      return !!cell && (cell.v !== '' || !!cell.f);
    };
    let r0 = o.r0;
    let c0 = o.c0;
    let r1 = o.r1;
    let c1 = o.c1;
    let grew = true;
    const rowHas = (r: number, a: number, b: number) => {
      for (let c = Math.max(0, a - 1); c <= Math.min(MAX_COL, b + 1); c++) if (filled(r, c)) return true;
      return false;
    };
    const colHas = (c: number, a: number, b: number) => {
      for (let r = Math.max(0, a - 1); r <= Math.min(MAX_ROW, b + 1); r++) if (filled(r, c)) return true;
      return false;
    };
    let guard = 0;
    while (grew && guard++ < 100000) {
      grew = false;
      if (r0 > 0 && rowHas(r0 - 1, c0, c1)) {
        r0--;
        grew = true;
      }
      if (r1 < MAX_ROW && rowHas(r1 + 1, c0, c1)) {
        r1++;
        grew = true;
      }
      if (c0 > 0 && colHas(c0 - 1, r0, r1)) {
        c0--;
        grew = true;
      }
      if (c1 < MAX_COL && colHas(c1 + 1, r0, r1)) {
        c1++;
        grew = true;
      }
    }
    return new ORange(this.m.ctx, o.sheet, r0, c0, r1, c1);
  }

  private currentRegion(): XRange {
    return new XRange(this.m, [this.currentRegionRaw()], 'cells');
  }

  enumerate(): unknown[] {
    const out: XRange[] = [];
    for (const a of this.areas) {
      const b = this.bounded(a);
      if (this.mode === 'rows') {
        for (let r = b.r0; r <= b.r1; r++) out.push(new XRange(this.m, [new ORange(this.m.ctx, a.sheet, r, a.c0, r, a.c1)], 'cells'));
      } else if (this.mode === 'columns') {
        for (let c = b.c0; c <= b.c1; c++) out.push(new XRange(this.m, [new ORange(this.m.ctx, a.sheet, a.r0, c, a.r1, c)], 'cells'));
      } else {
        if ((b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) > 2_000_000) fail(7);
        for (let c = b.c0; c <= b.c1; c++) for (let r = b.r0; r <= b.r1; r++) out.push(new XRange(this.m, [new ORange(this.m.ctx, a.sheet, r, c, r, c)], 'cells'));
      }
    }
    return out;
  }

  styleTokens(): Map<string, string> {
    const o = this.o;
    const st = this.m.ctx.sheet(o.sheet).styles.get(o.r0 * KEY + o.c0) ?? '';
    const map = new Map<string, string>();
    for (const t of st.split(';').filter(Boolean)) {
      const i = t.indexOf(':');
      if (i < 0) map.set(t, '');
      else map.set(t.slice(0, i), t.slice(i + 1));
    }
    return map;
  }

  applyStyle(patch: string): void {
    this.styleAll(patch);
  }
}

function typedFormulaValue(t: string): unknown {
  if (t === '') return '';
  if (t.startsWith('=')) return t;
  const v = typedCell(t);
  return v === undefined ? '' : v;
}

class XAreas extends HostObject {
  readonly typeName = 'Areas';
  constructor(private readonly m: ExcelModel, private readonly areas: ORange[]) {
    super();
  }

  member(name: string, args: unknown[]): unknown {
    if (name === 'count') return this.areas.length;
    if (name === '' || name === 'item') {
      const i = Math.round(toNum(args[0]));
      if (i < 1 || i > this.areas.length) fail(9);
      return new XRange(this.m, [this.areas[i - 1]], 'cells');
    }
    return fail(438);
  }

  enumerate(): unknown[] {
    return this.areas.map((a) => new XRange(this.m, [a], 'cells'));
  }
}

class XFont extends HostObject {
  readonly typeName = 'Font';
  constructor(private readonly r: XRange) {
    super();
  }

  member(name: string, _args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    const r = this.r;
    const t = r.styleTokens();
    switch (name) {
      case 'bold':
        if (mode === 0) return t.has('b');
        r.applyStyle(toBool(value) ? 'b' : '!b');
        return undefined;
      case 'italic':
        if (mode === 0) return t.has('i');
        r.applyStyle(toBool(value) ? 'i' : '!i');
        return undefined;
      case 'underline':
        if (mode === 0) return t.has('u') ? 2 : -4142;
        r.applyStyle(toNum(value) === -4142 || value === false ? '!u' : 'u');
        return undefined;
      case 'strikethrough':
        if (mode === 0) return t.has('s');
        r.applyStyle(toBool(value) ? 's' : '!s');
        return undefined;
      case 'size':
        if (mode === 0) return Number(t.get('sz') ?? 11);
        r.applyStyle(`sz:${Math.max(1, Math.min(96, Math.round(toNum(value))))}`);
        return undefined;
      case 'name':
        if (mode === 0) return t.get('ff') ?? 'Calibri';
        r.applyStyle(`ff:${toStr(value)}`);
        return undefined;
      case 'color':
        if (mode === 0) return t.has('fc') ? rgbToVba(t.get('fc') as string) : 0;
        r.applyStyle(`fc:${vbaToHex(toNum(value))}`);
        return undefined;
      case 'colorindex':
        if (mode === 0) return t.has('fc') ? hexToColorIndex(t.get('fc') as string) : -4105;
        r.applyStyle(toNum(value) === -4105 ? '!fc' : `fc:${colorIndexToHex(toNum(value))}`);
        return undefined;
      case 'fontstyle':
        if (mode === 0) return t.has('b') && t.has('i') ? 'Bold Italic' : t.has('b') ? 'Bold' : t.has('i') ? 'Italic' : 'Regular';
        {
          const s = toStr(value).toLowerCase();
          r.applyStyle(s.includes('bold') ? 'b' : '!b');
          r.applyStyle(s.includes('italic') ? 'i' : '!i');
        }
        return undefined;
      case 'superscript':
      case 'subscript':
      case 'themecolor':
      case 'tintandshade':
        return mode === 0 ? false : undefined;
      default:
        return fail(438);
    }
  }
}

class XInterior extends HostObject {
  readonly typeName = 'Interior';
  constructor(private readonly r: XRange) {
    super();
  }

  member(name: string, _args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    const r = this.r;
    const t = r.styleTokens();
    switch (name) {
      case 'color':
        if (mode === 0) return t.has('bg') ? rgbToVba(t.get('bg') as string) : 16777215;
        r.applyStyle(`bg:${vbaToHex(toNum(value))}`);
        return undefined;
      case 'colorindex':
        if (mode === 0) return t.has('bg') ? hexToColorIndex(t.get('bg') as string) : -4142;
        r.applyStyle(toNum(value) === -4142 || toNum(value) === -4105 ? '!bg' : `bg:${colorIndexToHex(toNum(value))}`);
        return undefined;
      case 'pattern':
        if (mode === 0) return t.has('bg') ? 1 : -4142;
        if (toNum(value) === -4142) r.applyStyle('!bg');
        return undefined;
      case 'patterncolor':
      case 'patterncolorindex':
      case 'themecolor':
      case 'tintandshade':
      case 'patterntintandshade':
        return mode === 0 ? 0 : undefined;
      default:
        return fail(438);
    }
  }
}

const EDGE_NAME: Record<number, string> = { 5: 'DiagonalDown', 6: 'DiagonalUp', 7: 'EdgeLeft', 8: 'EdgeTop', 9: 'EdgeBottom', 10: 'EdgeRight', 11: 'InsideVertical', 12: 'InsideHorizontal' };
const LINE_STYLE: Record<number, string> = { 1: 'Continuous', [-4115]: 'Dash', 4: 'DashDot', 5: 'DashDotDot', [-4118]: 'Dot', [-4119]: 'Double', 13: 'SlantDashDot', [-4142]: 'None' };
const WEIGHT: Record<number, string> = { 1: 'Hairline', 2: 'Thin', [-4138]: 'Medium', 4: 'Thick' };

class XBorder extends HostObject {
  readonly typeName = 'Border';
  constructor(private readonly r: XRange, private readonly edges: number[], private readonly all = false) {
    super();
  }

  member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    if (name === '' || name === 'item') return new XBorder(this.r, [toNum(args[0])]);
    if (name === 'count') return this.edges.length;
    const edges = this.all ? this.edges.filter((e) => (e === 11 ? this.r.o.c1 > this.r.o.c0 : e === 12 ? this.r.o.r1 > this.r.o.r0 : e <= 12 && e >= 7)) : this.edges;
    const apply = (fn: (b: ReturnType<ORange['getFormat']>['getRangeBorder'] extends (i: string) => infer R ? R : never) => void) => {
      for (const a of this.r.areas) for (const e of edges) if (EDGE_NAME[e]) fn(a.getFormat().getRangeBorder(EDGE_NAME[e]));
    };
    switch (name) {
      case 'linestyle': {
        if (mode === 0) {
          const b = this.r.o.getFormat().getRangeBorder(EDGE_NAME[this.edges[0]]);
          const s = b.getStyle();
          return Number(Object.keys(LINE_STYLE).find((k) => LINE_STYLE[Number(k)] === s) ?? -4142);
        }
        const s = LINE_STYLE[toNum(value)];
        if (!s) fail(1004, 'Unable to set the LineStyle property of the Border class');
        apply((b) => b.setStyle(s));
        return undefined;
      }
      case 'weight': {
        if (mode === 0) {
          const w = this.r.o.getFormat().getRangeBorder(EDGE_NAME[this.edges[0]]).getWeight();
          return Number(Object.keys(WEIGHT).find((k) => WEIGHT[Number(k)] === w) ?? 2);
        }
        const w = WEIGHT[toNum(value)];
        if (!w) fail(1004, 'Unable to set the Weight property of the Border class');
        apply((b) => b.setWeight(w));
        return undefined;
      }
      case 'color':
        if (mode === 0) return 0;
        apply((b) => b.setColor(`#${vbaToHex(toNum(value))}`));
        return undefined;
      case 'colorindex':
        if (mode === 1) apply((b) => b.setColor(`#${colorIndexToHex(toNum(value))}`));
        return mode === 0 ? 1 : undefined;
      case 'tintandshade':
      case 'themecolor':
        return mode === 0 ? 0 : undefined;
      default:
        return fail(438);
    }
  }

  enumerate(): unknown[] {
    return this.edges.map((e) => new XBorder(this.r, [e]));
  }
}
