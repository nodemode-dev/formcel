import { Ctx } from '../automation/officeApi';
import type { Snapshot } from '../automation/officeTypes';
import { ExcelModel, XSheet } from './excel';
import { Interp, RefArg } from './interp';
import type { CompileProblem, Location, RunResult, StepAction, VbaEngine, VbaEvent, VbaHost, VbaModule } from './types';
import { XL } from './xlconst';
import { VArray, VDate, VError, VbaError, HostObject, MISSING, NULLV, isObj, toStr } from './values';

export function blankSnapshot(names: string[] = ['Sheet1']): Snapshot {
  return {
    sheets: names.map((name) => ({ name, cells: [], styles: [], formats: [], merges: [], visible: 'Visible', tab: '', grid: true, freeze: [0, 0], cols: [], rows: [] })),
    active: names[0],
    selection: { sheet: names[0], r0: 0, c0: 0, r1: 0, c1: 0 },
    tables: [],
    charts: [],
    pivots: [],
    names: [],
    title: 'Book1',
  };
}

export interface EventSpec {
  name: string;
  sheet?: string;
  target?: { sheet: string; r0: number; c0: number; r1: number; c1: number };
  args?: unknown[];
}

export class VbaRuntime implements VbaEngine {
  readonly interp: Interp;
  ctx: Ctx | null = null;
  model: ExcelModel | null = null;
  limitMs = 300000;
  private modules: VbaModule[] = [];

  constructor(readonly host: VbaHost) {
    this.interp = new Interp(host);
    Object.assign(this.interp.consts, XL);
  }

  attach(ctx: Ctx): void {
    this.ctx = ctx;
    this.model = new ExcelModel(ctx, this.interp, this.host);
    this.model.install(this.interp);
  }

  async load(modules: VbaModule[]): Promise<CompileProblem[]> {
    this.modules = modules;
    const problems = await this.interp.load(modules);
    if (this.model) this.model.install(this.interp);
    return problems;
  }

  loadedModules(): VbaModule[] {
    return this.modules;
  }

  on(fn: (e: VbaEvent) => void): () => void {
    return this.interp.on(fn);
  }

  setBreakpoints(module: string, lines: number[]): void {
    this.interp.setBreakpoints(module, lines);
  }

  resume(action: StepAction): void {
    this.interp.resume(action);
  }

  stop(): void {
    this.interp.abort();
  }

  procedures() {
    return this.interp.procedures();
  }

  evaluate(text: string): Promise<string> {
    return this.interp.evaluateText(text);
  }

  async stepInto(procName: string, args: unknown[] = []): Promise<RunResult> {
    this.interp.startStepping();
    return this.run(procName, args);
  }

  describe(e: unknown): { number: number; description: string; source: string; location: Location } {
    const err = this.interp.toVbaError(e);
    return { number: err.number, description: err.description, source: err.source, location: this.interp.lastLoc ?? { module: this.interp.curMod, proc: this.interp.curProc, line: this.interp.curLine } };
  }

  async run(procName: string, args: unknown[] = []): Promise<RunResult> {
    this.interp.lastLoc = null;
    this.interp.err.clear();
    try {
      const value = await this.interp.runProc(procName, args, this.limitMs);
      const out = await this.model?.sync(true).then(() => value);
      this.interp.emit({ type: 'done', ok: true });
      return { ok: true, value: out };
    } catch (e) {
      const d = this.describe(e);
      this.interp.emit({ type: 'error', ...d });
      this.interp.emit({ type: 'done', ok: false });
      return { ok: false, error: d };
    }
  }

  async fire(spec: EventSpec): Promise<{ ran: boolean; cancel: boolean }> {
    const m = this.model;
    if (!m || !m.enableEvents) return { ran: false, cancel: false };
    let ran = false;
    let cancel = false;
    const name = spec.name.toLowerCase();
    const lower = `worksheet_${name}`;
    const wbSheet = `workbook_sheet${name}`;
    for (const mod of this.interp.mods.values()) {
      if (mod.kind !== 'document') continue;
      const doc = this.interp.docObject(mod);
      if (mod.name.toLowerCase() === 'thisworkbook') {
        const p = mod.procs.get(wbSheet);
        if (p && spec.sheet) {
          ran = true;
          const sheet = m.sheetObj(spec.sheet);
          await this.safeRun(() => this.interp.runHandler(mod, wbSheet, spec.target ? [sheet, m.rangeFrom(spec.target)] : [sheet], doc));
        }
        const direct = mod.procs.get(`workbook_${name}`);
        if (direct) {
          ran = true;
          const cancelRef = { v: false, t: { name: 'boolean' } };
          const extra = spec.args ?? [];
          const argv = [...extra, ...(direct[0].params.length > extra.length ? [new RefArg(cancelRef)] : [])];
          await this.safeRun(() => this.interp.runHandler(mod, `workbook_${name}`, argv, doc));
          if (cancelRef.v) cancel = true;
        }
        continue;
      }
      if (!spec.sheet || !(doc instanceof XSheet) || doc.name !== spec.sheet) continue;
      const p = mod.procs.get(lower);
      if (!p) continue;
      ran = true;
      const cancelRef = { v: false, t: { name: 'boolean' } };
      const argv: unknown[] = [];
      if (spec.target) argv.push(m.rangeFrom(spec.target));
      if (p[0].params.length > argv.length) argv.push(new RefArg(cancelRef));
      await this.safeRun(() => this.interp.runHandler(mod, lower, argv, doc));
      if (cancelRef.v) cancel = true;
    }
    return { ran, cancel };
  }

  private async safeRun(fn: () => Promise<boolean>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      const d = this.describe(e);
      this.interp.emit({ type: 'error', ...d });
    }
  }

  udfNames(): string[] {
    const out: string[] = [];
    for (const m of this.interp.mods.values()) {
      if (m.kind !== 'std') continue;
      for (const ps of m.procs.values()) for (const p of ps) if (p.kind === 'function' && p.vis !== 'private') out.push(p.raw);
    }
    return out;
  }

  async callFunction(name: string, args: unknown[]): Promise<unknown> {
    const hit = this.interp.findProc(name);
    if (!hit || hit.proc.kind !== 'function') throw new VbaError(35, `${name} is not a function`);
    const names = new Set<string>(['Sheet1']);
    const prepared: unknown[] = [];
    const cells: { sheet: string; rows: unknown[][] }[] = [];
    hit.proc.params.forEach((p, i) => {
      const a = args[i];
      if (i >= args.length) prepared.push(MISSING);
      else if (Array.isArray(a) && p.type.name === 'range') {
        const sheet = `\u0001arg${i}`;
        names.add(sheet);
        cells.push({ sheet, rows: a as unknown[][] });
        prepared.push(sheet);
      } else prepared.push(a);
    });
    const snap = blankSnapshot([...names]);
    for (const c of cells) {
      const sh = snap.sheets.find((s) => s.name === c.sheet);
      if (!sh) continue;
      c.rows.forEach((row, r) =>
        row.forEach((v, col) => {
          if (v === '' || v === null || v === undefined) return;
          const text = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(v) : /^[+-]?(\d+\.?\d*|\.\d+)$/.test(String(v)) || /^(TRUE|FALSE)$/i.test(String(v)) ? `'${String(v)}` : String(v);
          sh.cells.push([r, col, text, undefined, false, String(v)]);
        }),
      );
    }
    const ctx = new Ctx();
    ctx.load(snap);
    this.attach(ctx);
    const m = this.model as ExcelModel;
    const argv = prepared.map((a) => {
      if (typeof a === 'string' && a.startsWith('\u0001arg')) {
        const sheet = a;
        const rows = cells.find((c) => c.sheet === sheet)?.rows ?? [[]];
        return m.rangeFrom({ sheet, r0: 0, c0: 0, r1: Math.max(0, rows.length - 1), c1: Math.max(0, (rows[0]?.length ?? 1) - 1) });
      }
      if (Array.isArray(a)) {
        const rows = a as unknown[][];
        const arr = VArray.make([1, 1], [rows.length, rows[0]?.length ?? 1], () => undefined, false);
        rows.forEach((row, r) => row.forEach((v, c) => (arr.data[r * (rows[0]?.length ?? 1) + c] = v === '' ? undefined : v)));
        return rows.length === 1 && (rows[0]?.length ?? 0) === 1 ? rows[0][0] : arr;
      }
      return a === '' ? undefined : a;
    });
    this.interp.lastLoc = null;
    const value = await this.interp.runProc(`${hit.mod.name}.${hit.proc.raw}`, argv, 5000);
    return this.plain(value);
  }

  async plain(v: unknown): Promise<unknown> {
    if (v === undefined || v === MISSING || v === NULLV) return '';
    if (v instanceof VDate) return v.serial;
    if (v instanceof VError) throw Object.assign(new Error(v.text), { excelCode: v.text });
    if (v instanceof VArray) {
      const rows = v.dims === 2 ? v.ub[0] - v.lb[0] + 1 : 1;
      const cols = v.dims === 2 ? v.ub[1] - v.lb[1] + 1 : v.data.length;
      const out: unknown[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: unknown[] = [];
        for (let c = 0; c < cols; c++) row.push(await this.plain(v.data[r * cols + c]));
        out.push(row);
      }
      return out;
    }
    if (isObj(v) && v instanceof HostObject && v.defaultProp) return this.plain(await v.member(v.defaultProp, [], 0));
    if (v === null) return '';
    if (typeof v === 'object') return toStr(v);
    return v;
  }

  errorCode(e: unknown): string {
    const err = this.interp.toVbaError(e);
    if (err.number === 11) return '#DIV/0!';
    if (err.number === 13) return '#VALUE!';
    if (err.number === 9 || err.number === 1004) return '#VALUE!';
    return '#VALUE!';
  }
}
